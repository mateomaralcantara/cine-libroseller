import { RESOURCES } from './schema.js';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/;

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function validDate(s) {
  const d = new Date(s.slice(0, 10) + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s.slice(0, 10);
}

/**
 * Valida y normaliza un cuerpo según la definición del recurso.
 * partial=true para actualizaciones (sólo valida campos presentes).
 */
export function validate(db, resourceName, body, { partial = false } = {}) {
  const r = RESOURCES[resourceName];
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Cuerpo inválido');
  const data = {};
  const errors = {};

  for (const f of r.fields) {
    if (f.readonly || f.virtual) continue;
    const present = Object.prototype.hasOwnProperty.call(body, f.key);
    let v = body[f.key];
    if (!present) {
      if (partial) continue;
      v = f.default ?? null;
    }
    if (typeof v === 'string') v = v.trim();
    if (v === '' || v === undefined) v = null;

    if (v === null) {
      if (f.required) errors[f.key] = `${f.label} es obligatorio`;
      data[f.key] = f.type === 'bool' ? 0 : null;
      continue;
    }

    switch (f.type) {
      case 'text': case 'longtext':
        if (typeof v !== 'string') v = String(v);
        if (v.length > (f.max || (f.type === 'text' ? 300 : 20000))) errors[f.key] = `${f.label} es demasiado largo`;
        break;
      case 'email':
        v = String(v).toLowerCase();
        if (!EMAIL.test(v) || v.length > 254) errors[f.key] = 'Email inválido';
        break;
      case 'url':
        try {
          const u = new URL(String(v));
          if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
          v = u.toString();
        } catch { errors[f.key] = 'URL inválida (debe empezar por http:// o https://)'; }
        break;
      case 'enum':
        if (!f.options.includes(v)) errors[f.key] = `${f.label}: valor no permitido`;
        break;
      case 'date':
        v = String(v);
        if (!DATE.test(v) || !validDate(v)) errors[f.key] = 'Fecha inválida (AAAA-MM-DD)';
        break;
      case 'time':
        v = String(v).slice(0, 5);
        if (!TIME.test(v)) errors[f.key] = 'Hora inválida (HH:MM)';
        break;
      case 'datetime':
        v = String(v).replace(' ', 'T').slice(0, 16);
        if (!DATETIME.test(v) || !validDate(v)) errors[f.key] = 'Fecha y hora inválidas';
        break;
      case 'money': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0 || n > 1e12) errors[f.key] = `${f.label} debe ser un monto válido`;
        else v = Math.round(n * 100) / 100;
        break;
      }
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 1e9) errors[f.key] = `${f.label} debe ser un entero`;
        else v = n;
        break;
      }
      case 'bool':
        v = v === true || v === 1 || v === '1' || v === 'true' || v === 'on' ? 1 : 0;
        break;
      case 'ref': {
        const n = Number(v);
        if (!Number.isInteger(n) || n <= 0) { errors[f.key] = `${f.label} inválido`; break; }
        const exists = db.prepare(`SELECT 1 FROM "${f.ref}" WHERE id = ?`).get(n);
        if (!exists) errors[f.key] = `${f.label} no existe`;
        v = n;
        break;
      }
      default:
        break;
    }
    data[f.key] = v;
  }

  if (Object.keys(errors).length) throw new HttpError(422, 'Revisa los campos marcados', errors);
  return data;
}
