import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { RESOURCES } from './schema.js';

const SQL_TYPE = {
  text: 'TEXT', longtext: 'TEXT', email: 'TEXT', url: 'TEXT', enum: 'TEXT',
  date: 'TEXT', datetime: 'TEXT', time: 'TEXT',
  money: 'REAL', int: 'INTEGER', bool: 'INTEGER', ref: 'INTEGER',
};

function columnDef(f) {
  let def = `"${f.key}" ${SQL_TYPE[f.type] || 'TEXT'}`;
  if (f.type === 'ref') {
    def += ` REFERENCES "${f.ref}"(id) ON DELETE ${f.required ? 'RESTRICT' : 'SET NULL'}`;
  }
  return def;
}

const EXTRA_COLUMNS = {
  users: ['password_hash TEXT', 'failed_logins INTEGER DEFAULT 0', 'locked_until TEXT', 'last_login TEXT'],
  versions: ['submitted_by INTEGER', 'decided_by INTEGER', 'decided_at TEXT'],
};

const SYSTEM_TABLES = `
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  ip TEXT, user_agent TEXT
);
CREATE TABLE IF NOT EXISTS review_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES versions(id) ON DELETE CASCADE,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  timecode TEXT,
  note TEXT NOT NULL,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS integrations (
  provider TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  endpoint_url TEXT,
  secret TEXT,
  last_event_at TEXT
);
CREATE TABLE IF NOT EXISTS integration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  direction TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT,
  status TEXT NOT NULL,
  response TEXT,
  external_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_integration_external
  ON integration_events(provider, direction, external_id) WHERE external_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  detail TEXT,
  ip TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function openDb(file = process.env.DB_FILE || path.resolve('data/cine.db')) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db) {
  // Orden: tablas referenciadas primero (users/clients antes que el resto)
  const order = ['clients', 'users', 'offerings', 'talent', 'crew', 'projects', 'leads',
    'characters', 'shoots', 'shots', 'continuity', 'contracts', 'events', 'budget_items',
    'versions', 'deals', 'payments'];
  for (const name of Object.keys(RESOURCES)) if (!order.includes(name)) order.push(name);

  for (const name of order) {
    const r = RESOURCES[name];
    const cols = r.fields.filter((f) => !f.virtual);
    const extra = EXTRA_COLUMNS[name] || [];
    db.exec(`CREATE TABLE IF NOT EXISTS "${name}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${[...cols.map(columnDef), ...extra].join(',\n      ')},
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    // Migración aditiva: añade columnas nuevas del esquema
    const existing = new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name));
    for (const f of cols) {
      if (!existing.has(f.key)) {
        const def = `"${f.key}" ${SQL_TYPE[f.type] || 'TEXT'}`; // SQLite no admite REFERENCES en ALTER con FK activas de forma segura
        db.exec(`ALTER TABLE "${name}" ADD COLUMN ${def}`);
      }
    }
    for (const e of extra) {
      const col = e.split(' ')[0];
      if (!existing.has(col)) db.exec(`ALTER TABLE "${name}" ADD COLUMN ${e}`);
    }
    for (const f of cols) {
      if (f.type === 'ref' || f.key === 'status' || f.key === 'stage' || f.key === 'date') {
        db.exec(`CREATE INDEX IF NOT EXISTS "ix_${name}_${f.key}" ON "${name}"("${f.key}")`);
      }
      if (f.unique) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS "ux_${name}_${f.key}" ON "${name}"("${f.key}" COLLATE NOCASE)`);
    }
  }
  db.exec(SYSTEM_TABLES);
  db.prepare(`INSERT OR IGNORE INTO settings(key, value) VALUES ('fx_rates', ?)`)
    .run(JSON.stringify({ USD: 1, DOP: 59.5, EUR: 0.92, MXN: 18.2, COP: 4050 }));
  for (const p of ['libroseller', 'cineviral']) {
    db.prepare(`INSERT OR IGNORE INTO integrations(provider, enabled) VALUES (?, 0)`).run(p);
  }
}

export function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? JSON.parse(row.value) : fallback;
}

export function setSetting(db, key, value) {
  db.prepare(`INSERT INTO settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function audit(db, req, action, entity, entityId, detail) {
  db.prepare(`INSERT INTO audit_log(user_id, action, entity, entity_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(req?.user?.id ?? null, action, entity ?? null, entityId ?? null,
      detail ? JSON.stringify(detail).slice(0, 4000) : null, req?.ip ?? null);
}
