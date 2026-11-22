// Siembra: crea el administrador inicial y, con `npm run seed`, datos de demostración.
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { hashPassword, validatePassword } from './auth.js';
import { hooks } from './rules.js';

export function ensureAdmin(db) {
  const n = db.prepare('SELECT COUNT(*) n FROM users').get().n;
  if (n > 0) return null;
  const email = (process.env.ADMIN_EMAIL || 'admin@cine.libroseller.com').toLowerCase();
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password || validatePassword(password)) {
    if (password) console.warn('ADMIN_PASSWORD no cumple la política; se genera una aleatoria.');
    password = crypto.randomBytes(9).toString('base64url') + '7a';
    generated = true;
  }
  db.prepare(`INSERT INTO users(name, email, role, active, password_hash) VALUES (?, ?, 'admin', 1, ?)`)
    .run('Administración', email, hashPassword(password));
  if (generated) {
    console.log('\n──────────────────────────────────────────────');
    console.log(' Administrador inicial creado');
    console.log(`   email:      ${email}`);
    console.log(`   contraseña: ${password}`);
    console.log(' Cámbiala al entrar (Mi cuenta).');
    console.log('──────────────────────────────────────────────\n');
  }
  return { email, password };
}

const day = (offset) => new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);

function insert(db, table, row) {
  const cols = Object.keys(row);
  const info = db.prepare(`INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`)
    .run(...cols.map((c) => (typeof row[c] === 'boolean' ? Number(row[c]) : row[c])));
  return Number(info.lastInsertRowid);
}

export function seedDemo(db, { password = 'Demo2026cine' } = {}) {
  if (db.prepare('SELECT COUNT(*) n FROM projects').get().n > 0) {
    console.log('Ya hay proyectos: se omite la carga de demostración.');
    return;
  }
  const pw = hashPassword(password);
  const users = {};
  for (const [key, name, role] of [
    ['prod', 'Laura Peña', 'productor'], ['vfx', 'Marcos Díaz', 'vfx'], ['ventas', 'Carla Méndez', 'ventas'],
  ]) users[key] = insert(db, 'users', { name, email: `${key}@demo.cine.libroseller.com`, role, active: 1, password_hash: pw });

  const offerings = [
    ['Booktrailer cinematográfico', 'paquete', 'Tráiler de 60–90 s para novelas publicadas en LibroSeller, con actores o personajes IA.', 1200, 'por tráiler'],
    ['Cortometraje híbrido', 'paquete', 'Desarrollo, rodaje con croma y postproducción IA de un corto de hasta 15 min.', 18000, 'por proyecto'],
    ['Spot comercial', 'servicio', 'Comercial de 30 s para marca, con set extension y versiones para redes.', 6500, 'por pieza'],
    ['Supervisión VFX / IA por plano', 'servicio', 'Composición, limpieza, set extension o reemplazo consentido por plano.', 350, 'por plano'],
    ['Jornada de producción virtual', 'servicio', 'Set croma con tracking de cámara, previsualización en tiempo real y equipo técnico.', 2800, 'por jornada'],
    ['Licencia de catálogo', 'licencia', 'Derechos de exhibición de obras terminadas por territorio y ventana.', 5000, 'por territorio'],
  ];
  const off = offerings.map(([name, category, description, price_from, unit]) =>
    insert(db, 'offerings', { name, category, description, price_from, currency: 'USD', unit, public: 1 }));

  const c1 = insert(db, 'clients', { name: 'Editorial Caribe Letras', company: 'Caribe Letras SRL', kind: 'editorial', email: 'contacto@caribeletras.example', country: 'República Dominicana' });
  const c2 = insert(db, 'clients', { name: 'Ana Lucía Ferreira', kind: 'autor', email: 'ana.ferreira@example.com', country: 'República Dominicana' });
  const c3 = insert(db, 'clients', { name: 'Café Cibao', company: 'Café Cibao SA', kind: 'marca', email: 'marketing@cafecibao.example', country: 'República Dominicana' });

  const mk = (row) => { hooks.projects.beforeInsert(db, row); return insert(db, 'projects', row); };
  const p1 = mk({ title: 'La casa de las mareas', logline: 'Una restauradora descubre que la casa colonial que repara guarda la memoria de tres generaciones de mujeres.',
    client_id: c1, format: 'largometraje', source_type: 'novela', source_ref: 'ISBN 978-9945-00-000-1', production_mode: 'hibrido', stage: 'vfx',
    start_date: day(-90), delivery_date: day(25), currency: 'USD', price: 240000, producer_id: users.prod });
  const p2 = mk({ title: 'Booktrailer — El último zafra', logline: 'Tráiler para la novela de Ana Lucía Ferreira.', client_id: c2, format: 'trailer_libro',
    source_type: 'novela', source_ref: 'LibroSeller #4412', production_mode: 'ia_total', stage: 'revision', start_date: day(-14), delivery_date: day(6),
    currency: 'USD', price: 1800, producer_id: users.prod });
  const p3 = mk({ title: 'Despertar — Spot 30"', logline: 'Campaña de lanzamiento de la nueva línea de café de altura.', client_id: c3, format: 'comercial',
    source_type: 'guion', production_mode: 'croma', stage: 'preproduccion', start_date: day(-5), delivery_date: day(30), currency: 'DOP', price: 690000, producer_id: users.prod });

  const t1 = insert(db, 'talent', { name: 'Yamilé Castillo', kind: 'actor_real', agency: 'Agencia Quisqueya', rate_day: 450, currency: 'USD',
    likeness_consent: 'otorgado', voice_consent: 'limitado', consent_scope: 'Sólo «La casa de las mareas»: rejuvenecimiento en flashbacks y doblaje IA al inglés. Prohibido uso publicitario.', consent_expires: day(400) });
  const t2 = insert(db, 'talent', { name: 'Rafael Almonte', kind: 'actor_real', rate_day: 380, currency: 'USD', likeness_consent: 'pendiente', voice_consent: 'pendiente' });
  const t3 = insert(db, 'talent', { name: 'ARIA-07 (intérprete digital)', kind: 'interprete_digital', likeness_consent: 'no_aplica', voice_consent: 'no_aplica',
    notes: 'Personaje sintético propiedad del estudio. Modelo y LoRA en la biblia de continuidad.' });
  const t4 = insert(db, 'talent', { name: 'Miguel Ortega', kind: 'voz', rate_day: 200, currency: 'USD', likeness_consent: 'no_aplica', voice_consent: 'otorgado', consent_expires: day(20) });

  const ch1 = insert(db, 'characters', { project_id: p1, name: 'Elena (1958 y 2024)', kind: 'hibrido', actor_id: t1, voice_id: t1, age_range: '25 / 70', status: 'aprobado',
    description: 'Protagonista. Interpretada por Yamilé; versión joven mediante rejuvenecimiento IA.' });
  const ch2 = insert(db, 'characters', { project_id: p1, name: 'Tomás', kind: 'humano', actor_id: t2, age_range: '40', status: 'confirmado' });
  const ch3 = insert(db, 'characters', { project_id: p2, name: 'La cortadora', kind: 'ficticio_ia', digital_double_id: t3, voice_id: t4, status: 'aprobado' });

  insert(db, 'continuity', { project_id: p1, category: 'personaje', subject: 'Elena joven — rostro', character_id: ch1, scenes: '3, 7, 22',
    spec: 'Referencia: fotos de archivo 1998 autorizadas. Modelo de rejuvenecimiento v2, fuerza 0.65. Lunar mejilla izquierda visible siempre.', locked: 1 });
  insert(db, 'continuity', { project_id: p1, category: 'vestuario', subject: 'Vestido de lino azul', character_id: ch1, scenes: '3, 7', spec: 'Pantone 19-4052. Botón superior abierto.', locked: 0 });
  insert(db, 'continuity', { project_id: p1, category: 'escenario', subject: 'Casa colonial — fachada', scenes: '1, 3, 40', spec: 'Set extension sobre locación real en Zona Colonial; segundo piso CG.', locked: 1 });
  insert(db, 'continuity', { project_id: p2, category: 'personaje', subject: 'La cortadora — look', character_id: ch3, spec: 'Semilla 88123, LoRA cortadora_v4, luz cálida 3200K, sombrero de yarey.', locked: 1 });
  insert(db, 'continuity', { project_id: p2, category: 'voz', subject: 'Voz narradora', character_id: ch3, spec: 'Perfil de voz de Miguel Ortega, tono grave, ritmo pausado.', locked: 0 });

  const cr = [
    ['Paola Reyes', 'direccion', 600], ['Juan Bautista', 'fotografia', 450], ['Diana Soto', 'vfx', 300], ['Kevin Marte', 'ia', 280], ['Luis Abreu', 'sonido', 250],
  ].map(([name, role, rate_day]) => insert(db, 'crew', { name, role, rate_day, currency: 'USD', availability: 'disponible' }));

  const s1 = insert(db, 'shoots', { project_id: p1, date: day(-40), call_time: '06:30', wrap_time: '18:00', type: 'exterior', location: 'Zona Colonial, Santo Domingo', scenes: '1, 3', status: 'rodado', tracking: 0 });
  insert(db, 'shoots', { project_id: p1, date: day(4), call_time: '07:00', wrap_time: '19:00', type: 'croma', location: 'Estudio A — croma verde', scenes: '22, 23', status: 'confirmado', tracking: 1 });
  insert(db, 'shoots', { project_id: p3, date: day(9), call_time: '08:00', wrap_time: '17:00', type: 'volumen_led', location: 'Estudio B — volumen LED', scenes: '1–4', status: 'planificado', tracking: 1 });

  insert(db, 'shots', { project_id: p1, code: 'CAS_003_010', scene: '3', technique: 'rejuvenecimiento', character_id: ch1, shoot_id: s1, assignee_id: cr[2], tool: 'Nuke + modelo propio', iterations: 3, due_date: day(10), cost_estimate: 900, status: 'revision' });
  insert(db, 'shots', { project_id: p1, code: 'CAS_001_020', scene: '1', technique: 'set_extension', shoot_id: s1, assignee_id: cr[2], tool: 'Blender + Nuke', iterations: 2, due_date: day(-2), cost_estimate: 1500, status: 'en_proceso' });
  insert(db, 'shots', { project_id: p1, code: 'CAS_022_005', scene: '22', technique: 'reemplazo_rostro', character_id: ch2, assignee_id: cr[3], tool: 'ComfyUI', due_date: day(18), cost_estimate: 700, status: 'pendiente' });
  insert(db, 'shots', { project_id: p2, code: 'ZAF_000_001', technique: 'ia_generativa', character_id: ch3, assignee_id: cr[3], tool: 'Runway + ComfyUI', iterations: 4, due_date: day(3), cost_estimate: 200, status: 'aprobado' });

  insert(db, 'contracts', { project_id: p1, title: 'Contrato de interpretación y réplica digital', party_type: 'talento', party_name: 'Yamilé Castillo', talent_id: t1, amount: 13500, currency: 'USD', start_date: day(-95), end_date: day(400), ai_clause: 1, status: 'firmado' });
  insert(db, 'contracts', { project_id: p1, title: 'Contrato de interpretación', party_type: 'talento', party_name: 'Rafael Almonte', talent_id: t2, amount: 9000, currency: 'USD', start_date: day(-95), end_date: day(60), ai_clause: 0, status: 'enviado' });
  insert(db, 'contracts', { project_id: p1, title: 'Opción de derechos de adaptación', party_type: 'autor', party_name: 'Editorial Caribe Letras', client_id: c1, amount: 15000, currency: 'USD', start_date: day(-120), end_date: day(600), status: 'firmado' });
  insert(db, 'contracts', { project_id: p2, title: 'Locución y voz sintética', party_type: 'talento', party_name: 'Miguel Ortega', talent_id: t4, amount: 400, currency: 'USD', end_date: day(20), ai_clause: 1, status: 'firmado' });

  const budget = [
    [p1, 'talento', 'Elenco principal', 30000, 28500], [p1, 'equipo', 'Equipo técnico 24 jornadas', 52000, 49800], [p1, 'locaciones', 'Zona Colonial y estudio', 18000, 21400],
    [p1, 'vfx_ia', 'Paquete VFX/IA 140 planos', 46000, 31000], [p1, 'computo_ia', 'GPU en la nube', 6000, 7900], [p1, 'postproduccion', 'Montaje, color y mezcla', 22000, 4000], [p1, 'legal', 'Derechos y contratos', 15000, 15000],
    [p2, 'computo_ia', 'Generación y escalado', 150, 210], [p2, 'talento', 'Locución', 400, 400], [p2, 'postproduccion', 'Edición y música', 350, 300],
    [p3, 'equipo', 'Equipo de rodaje', 250000, 0], [p3, 'locaciones', 'Volumen LED 1 jornada', 160000, 80000], [p3, 'vfx_ia', 'Composición y versiones', 90000, 0],
  ];
  for (const [project_id, category, description, planned, actual] of budget) insert(db, 'budget_items', { project_id, category, description, planned, actual, paid: actual > 0 ? 1 : 0 });

  const d1 = insert(db, 'deals', { title: 'Producción «La casa de las mareas»', kind: 'produccion', project_id: p1, client_id: c1, channel: 'directo', amount: 240000, currency: 'USD', stage: 'ganado', close_date: day(-100) });
  insert(db, 'deals', { title: 'Booktrailer «El último zafra»', kind: 'servicio', project_id: p2, client_id: c2, offering_id: off[0], channel: 'libroseller', amount: 1800, currency: 'USD', stage: 'ganado', close_date: day(-15) });
  const d3 = insert(db, 'deals', { title: 'Spot «Despertar»', kind: 'produccion', project_id: p3, client_id: c3, offering_id: off[2], channel: 'cineviral', amount: 690000, currency: 'DOP', stage: 'ganado', close_date: day(-6) });
  insert(db, 'deals', { title: 'Licencia LatAm «La casa de las mareas»', kind: 'licencia', project_id: p1, channel: 'plataforma', territory: 'Latinoamérica', amount: 85000, currency: 'USD', stage: 'negociacion', close_date: day(45) });
  insert(db, 'deals', { title: 'Serie de booktrailers Caribe Letras', kind: 'servicio', client_id: c1, offering_id: off[0], channel: 'libroseller', amount: 9600, currency: 'USD', stage: 'propuesta' });

  for (const [project_id, deal_id, direction, amount, currency, date, reference] of [
    [p1, d1, 'ingreso', 96000, 'USD', day(-95), 'Anticipo 40%'], [p1, d1, 'ingreso', 72000, 'USD', day(-30), 'Hito rodaje 30%'],
    [p1, null, 'egreso', 60000, 'USD', day(-60), 'Nómina rodaje'], [p2, null, 'ingreso', 900, 'USD', day(-14), 'Anticipo 50%'],
    [p3, d3, 'ingreso', 345000, 'DOP', day(-5), 'Anticipo 50%'],
  ]) insert(db, 'payments', { project_id, deal_id, direction, amount, currency, date, method: 'transferencia', reference });

  const v1 = insert(db, 'versions', { project_id: p2, label: 'Booktrailer v2', kind: 'trailer', url: 'https://media.example.com/zafra_v2.mp4', client_visible: 1, status: 'en_revision', submitted_by: users.vfx, notes: 'Incorpora la nueva voz y el plano final del cañaveral.' });
  db.prepare('INSERT INTO review_notes(version_id, author_id, timecode, note) VALUES (?, ?, ?, ?)').run(v1, users.prod, '00:00:42', 'Subir 2 dB la música en el clímax.');
  insert(db, 'versions', { project_id: p1, label: 'Offline v5', kind: 'offline', url: 'https://media.example.com/mareas_off_v5.mp4', client_visible: 1, status: 'aprobado', submitted_by: users.prod });
  insert(db, 'versions', { project_id: p1, label: 'VFX pass 2 — flashbacks', kind: 'vfx_pass', url: 'https://media.example.com/mareas_vfx2.mp4', client_visible: 0, status: 'en_revision', submitted_by: users.vfx });

  insert(db, 'events', { project_id: p1, title: 'Revisión de flashbacks con dirección', kind: 'revision', start: `${day(2)}T10:00`, end: `${day(2)}T12:00`, location: 'Sala de revisión' });
  insert(db, 'events', { project_id: p3, title: 'Casting barista', kind: 'casting', start: `${day(5)}T15:00`, location: 'Oficina Piantini' });
  insert(db, 'events', { title: 'Reunión comercial semanal', kind: 'reunion', start: `${day(1)}T09:00`, location: 'Virtual' });

  for (const l of [
    { name: 'Héctor Rosario', email: 'hector@example.com', service: 'cortometraje', source_type: 'guion', budget_range: '5k-25k', origin: 'web', status: 'nuevo', message: 'Tengo un guion de 12 páginas de ciencia ficción ambientado en Samaná y quiero rodarlo con croma.' },
    { name: 'María José Liriano', email: 'mj@example.com', service: 'trailer_libro', source_type: 'novela', budget_range: '<5k', origin: 'libroseller', status: 'contactado', message: 'Booktrailer para mi novela juvenil «Los faros apagados».' },
    { name: 'Agencia Pulso', email: 'cuentas@pulso.example', company: 'Agencia Pulso', service: 'comercial', source_type: 'idea', budget_range: '25k-100k', origin: 'cineviral', status: 'propuesta', message: 'Campaña regional de telefonía con personaje virtual recurrente.' },
  ]) insert(db, 'leads', { ...l, assigned_to: users.ventas });

  // Usuario de portal para el cliente del booktrailer
  insert(db, 'users', { name: 'Ana Lucía Ferreira', email: 'cliente@demo.cine.libroseller.com', role: 'cliente', client_id: c2, active: 1, password_hash: pw });

  console.log(`Datos de demostración cargados. Usuarios *@demo.cine.libroseller.com (prod, vfx, ventas, cliente) con contraseña: ${password}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDb } = await import('./db.js');
  const db = openDb();
  ensureAdmin(db);
  seedDemo(db, { password: process.env.DEMO_PASSWORD || undefined });
  db.close();
}
