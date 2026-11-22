// Crea (o promueve) una cuenta de administración.
// Uso: ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:create   (o: npm run admin:create -- email "Nombre")
import './load-env';
import crypto from 'node:crypto';
import postgres from 'postgres';
import { databaseUrl } from './database-url';
import { hashPassword, passwordProblem } from '../src/lib/auth/password';

async function main() {
  const url = databaseUrl();
  const email = (process.argv[2] || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = process.argv[3] || process.env.ADMIN_NAME || 'Administración';
  if (!email) throw new Error('Indica el email: npm run admin:create -- tu@email.com "Tu nombre"');
  let password = process.env.ADMIN_PASSWORD;
  let generated = false;
  if (!password) { password = crypto.randomBytes(10).toString('base64url') + '7k'; generated = true; }
  const problem = passwordProblem(password);
  if (problem) throw new Error(`ADMIN_PASSWORD: ${problem}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    const [existing] = await sql`select id from profiles where lower(email) = ${email}`;
    let id: string;
    if (existing) {
      id = existing.id;
      await sql`update profiles set role = 'admin', status = 'active', password_hash = ${hashPassword(password)} where id = ${id}`;
    } else {
      [{ id }] = await sql`insert into profiles (email, password_hash, display_name, role) values (${email}, ${hashPassword(password)}, ${name}, 'admin') returning id`;
    }
    const [vp] = await sql`select id from viewer_profiles where profile_id = ${id} and is_default`;
    if (!vp) {
      const [n] = await sql`insert into viewer_profiles (profile_id, name, is_default) values (${id}, ${name}, true) returning id`;
      await sql`insert into viewer_preferences (viewer_profile_id) values (${n.id})`;
      await sql`insert into watchlists (viewer_profile_id) values (${n.id})`;
    }
    await sql`insert into admin_audit_logs (actor_id, action, entity_type, entity_id) values (${id}, 'admin.created_cli', 'profile', ${id})`;
    console.log(`Administrador listo: ${email}`);
    if (generated) console.log(`Contraseña generada (cópiala ahora, no se vuelve a mostrar): ${password}`);
  } finally {
    await sql.end();
  }
}

main().catch((e) => { console.error(`✗ ${e.message}`); process.exitCode = 1; });
