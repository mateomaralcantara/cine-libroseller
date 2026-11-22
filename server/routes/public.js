import { Router } from 'express';
import { rateLimit } from '../auth.js';
import { validate, HttpError } from '../validate.js';
import { audit } from '../db.js';

export function publicRouter(db) {
  const r = Router();

  r.get('/offerings', (_req, res) => {
    const rows = db.prepare(`SELECT id, name, category, description, price_from, currency, unit FROM offerings WHERE public = 1 ORDER BY category, price_from`).all();
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ rows });
  });

  r.get('/showcase', (_req, res) => {
    // Sólo proyectos entregados o en distribución, sin datos económicos ni de clientes
    const rows = db.prepare(`SELECT code, title, logline, format, production_mode FROM projects
      WHERE stage IN ('entregado','distribucion') ORDER BY updated_at DESC LIMIT 6`).all();
    res.json({ rows });
  });

  r.post('/leads', rateLimit({ windowMs: 10 * 60e3, max: 5, key: 'public-lead' }), (req, res) => {
    const b = req.body || {};
    if (b.website) return res.status(201).json({ ok: true }); // honeypot: bots
    if (b.privacy !== true && b.privacy !== 'on' && b.privacy !== 'true') {
      throw new HttpError(422, 'Debes aceptar la política de privacidad', { privacy: 'Obligatorio' });
    }
    const utm = String(b.utm_source || '').toLowerCase();
    const origin = utm === 'cineviral' ? 'cineviral' : utm === 'libroseller' ? 'libroseller' : 'web';
    const data = validate(db, 'leads', {
      name: b.name, email: b.email, phone: b.phone, company: b.company, country: b.country,
      service: b.service, source_type: b.source_type, budget_range: b.budget_range || 'por_definir',
      message: b.message, origin,
    });
    if (!data.message || data.message.length < 20) {
      throw new HttpError(422, 'Revisa los campos marcados', { message: 'Cuéntanos un poco más sobre tu proyecto (mín. 20 caracteres)' });
    }
    const cols = Object.keys(data);
    const info = db.prepare(`INSERT INTO leads(${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
      .run(...cols.map((c) => data[c]));
    audit(db, req, 'public_lead', 'leads', Number(info.lastInsertRowid), { origin });
    res.status(201).json({ ok: true, reference: `SOL-${String(info.lastInsertRowid).padStart(5, '0')}` });
  });

  return r;
}
