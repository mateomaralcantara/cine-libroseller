import { Router } from 'express';
import { RESOURCES, PRIVATE_COLUMNS } from '../schema.js';
import { can, hashPassword, validatePassword } from '../auth.js';
import { validate, HttpError } from '../validate.js';
import { hooks } from '../rules.js';
import { audit } from '../db.js';

const FILTERABLE = new Set(['enum', 'ref', 'bool', 'date']);
const SEARCHABLE = new Set(['text', 'longtext', 'email']);

export function stripPrivate(name, row) {
  if (!row) return row;
  for (const c of PRIVATE_COLUMNS[name] || []) delete row[c];
  if (name === 'users') { delete row.failed_logins; delete row.locked_until; }
  return row;
}

/** Restricciones de fila para el rol cliente (portal). */
function scopeClause(name, user) {
  if (user.role !== 'cliente') return { sql: '', params: [] };
  const r = RESOURCES[name];
  const cid = user.client_id ?? -1;
  if (r.scope === 'client') return { sql: 't.client_id = ?', params: [cid] };
  if (r.scope === 'project') {
    return { sql: 't.client_visible = 1 AND t.project_id IN (SELECT id FROM projects WHERE client_id = ?)', params: [cid] };
  }
  return { sql: '1 = 0', params: [] };
}

/** Resuelve etiquetas legibles para las referencias de un conjunto de filas. */
export function refLabels(db, name, rows) {
  const labels = {};
  for (const f of RESOURCES[name].fields.filter((x) => x.type === 'ref')) {
    const ids = [...new Set(rows.map((r) => r[f.key]).filter((v) => v != null))];
    if (!ids.length) continue;
    const target = RESOURCES[f.ref];
    const col = target.display;
    const extra = f.ref === 'projects' ? ', code' : '';
    const found = db.prepare(`SELECT id, "${col}" AS label${extra} FROM "${f.ref}" WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
    labels[f.key] = Object.fromEntries(found.map((x) => [x.id, x.code ? `${x.code} · ${x.label}` : String(x.label ?? `#${x.id}`)]));
  }
  return labels;
}

export function crudRouter(db) {
  const router = Router();

  router.param('resource', (req, _res, next, name) => {
    if (!Object.prototype.hasOwnProperty.call(RESOURCES, name)) throw new HttpError(404, 'Recurso desconocido');
    req.resource = name;
    req.def = RESOURCES[name];
    next();
  });

  const guard = (mode) => (req, _res, next) => {
    if (!can(req.user, req.resource, mode)) throw new HttpError(403, 'No tienes permiso para esta acción');
    next();
  };

  function loadOne(req, id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Identificador inválido');
    const scope = scopeClause(req.resource, req.user);
    const row = db.prepare(`SELECT t.* FROM "${req.resource}" t WHERE t.id = ?${scope.sql ? ` AND ${scope.sql}` : ''}`)
      .get(n, ...scope.params);
    if (!row) throw new HttpError(404, `${req.def.singular} no encontrado`);
    return row;
  }

  router.get('/:resource', guard('read'), (req, res) => {
    const { def, resource } = req;
    const where = [];
    const params = [];
    const scope = scopeClause(resource, req.user);
    if (scope.sql) { where.push(scope.sql); params.push(...scope.params); }

    for (const f of def.fields) {
      if (!FILTERABLE.has(f.type) || req.query[f.key] === undefined || req.query[f.key] === '') continue;
      const raw = String(req.query[f.key]);
      if (raw === 'null') { where.push(`t."${f.key}" IS NULL`); continue; }
      const values = raw.split(',').slice(0, 20);
      where.push(`t."${f.key}" IN (${values.map(() => '?').join(',')})`);
      params.push(...values.map((v) => (f.type === 'ref' || f.type === 'bool' ? Number(v) : v)));
    }
    if (req.query.from && def.fields.some((f) => f.key === 'date')) { where.push('t.date >= ?'); params.push(String(req.query.from)); }
    if (req.query.to && def.fields.some((f) => f.key === 'date')) { where.push('t.date <= ?'); params.push(String(req.query.to)); }

    const q = String(req.query.q || '').trim().slice(0, 100);
    if (q) {
      const cols = def.fields.filter((f) => SEARCHABLE.has(f.type) && !f.virtual).map((f) => `t."${f.key}"`);
      if (resource === 'projects') cols.push('t.code');
      where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
      const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
      params.push(...cols.map(() => like));
    }

    const sortable = new Set(['id', 'created_at', 'updated_at', ...def.fields.filter((f) => !f.virtual).map((f) => f.key)]);
    const sort = sortable.has(req.query.sort) ? req.query.sort : 'id';
    const dir = req.query.dir === 'asc' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const total = db.prepare(`SELECT COUNT(*) AS n FROM "${resource}" t ${whereSql}`).get(...params).n;
    const rows = db.prepare(`SELECT t.* FROM "${resource}" t ${whereSql} ORDER BY t."${sort}" ${dir}, t.id DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset).map((r) => stripPrivate(resource, { ...r }));
    res.json({ rows, total, labels: refLabels(db, resource, rows) });
  });

  router.get('/:resource/:id', guard('read'), (req, res) => {
    const row = stripPrivate(req.resource, { ...loadOne(req, req.params.id) });
    res.json({ row, labels: refLabels(db, req.resource, [row]) });
  });

  function handlePassword(req, data, creating) {
    if (req.resource !== 'users') return;
    const pw = req.body.password;
    if (creating || (pw !== undefined && pw !== '' && pw !== null)) {
      const err = validatePassword(pw);
      if (err) throw new HttpError(422, 'Revisa los campos marcados', { password: err });
      data.password_hash = hashPassword(pw);
    }
    if (data.role === 'cliente' && !data.client_id && creating) {
      throw new HttpError(422, 'Revisa los campos marcados', { client_id: 'Un usuario de portal debe estar vinculado a un cliente' });
    }
  }

  function writeError(e) {
    const msg = String(e.message || '');
    if (msg.includes('UNIQUE')) return new HttpError(409, 'Ya existe un registro con ese valor único (p. ej. el email)');
    if (msg.includes('FOREIGN KEY')) return new HttpError(409, 'No se puede completar: hay registros vinculados que dependen de éste');
    return e;
  }

  router.post('/:resource', guard('write'), (req, res) => {
    const data = validate(db, req.resource, req.body);
    handlePassword(req, data, true);
    const h = hooks[req.resource] || {};
    h.beforeInsert?.(db, data, req);
    h.beforeWrite?.(db, data, null, req);
    data.created_by = req.user.id;
    const cols = Object.keys(data);
    let info;
    try {
      info = db.prepare(`INSERT INTO "${req.resource}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
        .run(...cols.map((c) => data[c]));
    } catch (e) { throw writeError(e); }
    const id = Number(info.lastInsertRowid);
    audit(db, req, 'create', req.resource, id);
    const row = stripPrivate(req.resource, { ...db.prepare(`SELECT * FROM "${req.resource}" WHERE id = ?`).get(id) });
    res.status(201).json({ row });
  });

  router.put('/:resource/:id', guard('write'), (req, res) => {
    const existing = loadOne(req, req.params.id);
    const data = validate(db, req.resource, req.body, { partial: true });
    handlePassword(req, data, false);
    if (req.resource === 'users' && existing.id === req.user.id && (data.role && data.role !== 'admin' || data.active === 0)) {
      throw new HttpError(409, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta');
    }
    (hooks[req.resource] || {}).beforeWrite?.(db, data, existing, req);
    const cols = Object.keys(data);
    if (cols.length) {
      try {
        db.prepare(`UPDATE "${req.resource}" SET ${cols.map((c) => `"${c}" = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
          .run(...cols.map((c) => data[c]), existing.id);
      } catch (e) { throw writeError(e); }
      if (req.resource === 'users' && (data.password_hash || data.active === 0)) {
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND user_id != ?').run(existing.id, req.user.id);
      }
      audit(db, req, 'update', req.resource, existing.id, { fields: cols.filter((c) => c !== 'password_hash') });
    }
    const row = stripPrivate(req.resource, { ...db.prepare(`SELECT * FROM "${req.resource}" WHERE id = ?`).get(existing.id) });
    res.json({ row });
  });

  router.delete('/:resource/:id', guard('write'), (req, res) => {
    const existing = loadOne(req, req.params.id);
    if (req.resource === 'users' && existing.id === req.user.id) throw new HttpError(409, 'No puedes eliminar tu propia cuenta');
    try {
      db.prepare(`DELETE FROM "${req.resource}" WHERE id = ?`).run(existing.id);
    } catch (e) { throw writeError(e); }
    audit(db, req, 'delete', req.resource, existing.id, { display: existing[req.def.display] });
    res.json({ ok: true });
  });

  return router;
}
