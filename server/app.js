import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { publicMeta } from './schema.js';
import { authenticate, requireAuth, login, logout, sessionCookie, rateLimit } from './auth.js';
import { crudRouter } from './routes/crud.js';
import { workflowRouter } from './routes/workflows.js';
import { publicRouter } from './routes/public.js';
import { integrationsRouter, inboundHandler, ensurePublicationsTable } from './routes/integrations.js';
import { HttpError } from './validate.js';
import { audit } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function createApp({ db = openDb(), trustProxy = process.env.TRUST_PROXY === '1' } = {}) {
  ensurePublicationsTable(db);
  const app = express();
  const isProd = process.env.NODE_ENV === 'production';
  const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS || 'https://cine.libroseller.com').split(',').map((s) => s.trim()).filter(Boolean));
  app.set('trust proxy', trustProxy ? 1 : false);
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; media-src 'self' https:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (isProd) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  // Webhooks entrantes: cuerpo sin procesar para verificar la firma HMAC
  app.post('/api/hooks/:provider', rateLimit({ windowMs: 60e3, max: 120, key: 'hooks' }),
    express.raw({ type: '*/*', limit: '256kb' }), inboundHandler(db));

  app.use('/api', express.json({ limit: '200kb' }));

  // Protección CSRF: las peticiones que modifican datos deben venir del mismo origen
  app.use('/api', (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      const self = `${req.protocol}://${req.get('host')}`;
      if (origin !== self && !allowedOrigins.has(origin)) return next(new HttpError(403, 'Origen no permitido'));
    }
    const len = Number(req.headers['content-length'] || 0);
    if ((len > 0 || req.headers['transfer-encoding']) && !req.is('application/json')) {
      return next(new HttpError(415, 'Usa application/json'));
    }
    next();
  });

  app.use('/api', authenticate(db));
  app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'cine-libroseller-studios' }));
  app.use('/api/public', publicRouter(db));

  app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60e3, max: 20, key: 'login' }), (req, res) => {
    const out = login(db, req.body?.email, req.body?.password, req);
    if (out.error) {
      audit(db, req, 'login_failed', 'users', null, { email: String(req.body?.email || '').slice(0, 120) });
      throw new HttpError(401, out.error);
    }
    req.user = out.user;
    audit(db, req, 'login', 'users', out.user.id);
    res.set('Set-Cookie', sessionCookie(out.token, { secure: isProd }));
    res.json({ user: { id: out.user.id, name: out.user.name, email: out.user.email, role: out.user.role } });
  });

  app.post('/api/auth/logout', (req, res) => {
    logout(db, req.sessionToken);
    res.set('Set-Cookie', sessionCookie('', { secure: isProd, clear: true }));
    res.json({ ok: true });
  });

  app.use('/api', requireAuth);
  app.get('/api/meta', (_req, res) => res.json(publicMeta()));
  app.use('/api', workflowRouter(db));
  app.use('/api', integrationsRouter(db));
  app.use('/api/r', crudRouter(db));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Ruta no encontrada')));

  // Estáticos: sitio público en / y panel en /studio
  const pub = path.join(ROOT, 'public');
  app.use(express.static(pub, { index: 'index.html', extensions: ['html'], maxAge: isProd ? '1h' : 0 }));
  app.get(/^\/studio(\/.*)?$/, (_req, res) => res.sendFile(path.join(pub, 'studio', 'index.html')));
  app.use((_req, res) => res.status(404).sendFile(path.join(pub, '404.html')));

  // Errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'JSON inválido');
    if (err.type === 'entity.too.large') err = new HttpError(413, 'Contenido demasiado grande');
    const status = err.status || 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message, details: err.details });
  });

  return { app, db };
}
