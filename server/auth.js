import crypto from 'node:crypto';
import { RESOURCES } from './schema.js';

const SESSION_DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const COOKIE = 'cls_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.startsWith('scrypt$')) return false;
  const [, saltB64, hashB64] = stored.split('$');
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10) return 'La contraseña debe tener al menos 10 caracteres';
  if (pw.length > 200) return 'Contraseña demasiado larga';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'La contraseña debe combinar letras y números';
  return null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Hash ficticio para igualar tiempos cuando el usuario no existe
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex') + '1a');

export function login(db, email, password, req) {
  const user = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(String(email || '').trim());
  if (!user) {
    verifyPassword(String(password || ''), DUMMY_HASH);
    return { error: 'Credenciales inválidas' };
  }
  if (user.locked_until && new Date(user.locked_until + 'Z') > new Date()) {
    return { error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta más tarde.' };
  }
  if (!verifyPassword(String(password || ''), user.password_hash) || !user.active) {
    const failed = (user.failed_logins || 0) + 1;
    const lock = failed >= MAX_FAILED
      ? new Date(Date.now() + LOCK_MINUTES * 60e3).toISOString().slice(0, 19).replace('T', ' ')
      : null;
    db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failed, lock, user.id);
    return { error: 'Credenciales inválidas' };
  }
  db.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL, last_login = datetime('now') WHERE id = ?`).run(user.id);
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare(`INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent)
    VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'), ?, ?)`)
    .run(sha256(token), user.id, req.ip || null, String(req.headers['user-agent'] || '').slice(0, 200));
  db.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`).run();
  return { token, user };
}

export function logout(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionCookie(token, { secure, clear = false } = {}) {
  const attrs = [`${COOKIE}=${clear ? '' : token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (secure) attrs.push('Secure');
  attrs.push(clear ? 'Max-Age=0' : `Max-Age=${SESSION_DAYS * 86400}`);
  return attrs.join('; ');
}

export function authenticate(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.sessionToken = token;
    if (token) {
      const row = db.prepare(`SELECT u.id, u.name, u.email, u.role, u.client_id, u.active
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > datetime('now')`).get(sha256(token));
      if (row && row.active) req.user = row;
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión para continuar' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  next();
};

export function can(user, resource, mode) {
  const r = RESOURCES[resource];
  return !!(user && r && r.perms[mode].includes(user.role));
}

// Limitador de tasa en memoria (por IP + clave). Suficiente para una instancia;
// detrás de varias réplicas usar Redis o el límite del proxy.
export function rateLimit({ windowMs, max, key = 'global' }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const id = `${key}:${req.ip}`;
    const entry = hits.get(id);
    if (!entry || entry.reset < now) {
      hits.set(id, { count: 1, reset: now + windowMs });
    } else if (++entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.' });
    }
    if (hits.size > 10000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    next();
  };
}
