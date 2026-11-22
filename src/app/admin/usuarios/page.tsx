import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';
import { ActionForm } from '../ui';
import { setUserRoleAction } from '../actions';

export default async function UsersAdmin({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const { q = '' } = await searchParams;
  const like = `%${q.replace(/[\\%_]/g, (m) => '\\' + m)}%`;
  const users = await sql`select id, email, display_name, role, status, created_at, last_login_at from profiles
    where ${q ? sql`(email ilike ${like} or display_name ilike ${like})` : sql`true`} order by (role <> 'viewer') desc, created_at desc limit 200`;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><h1 className="display text-3xl">Usuarios</h1>
        <form className="flex gap-2"><input name="q" defaultValue={q} placeholder="Buscar email o nombre" className="field" /><button className="btn btn-ghost btn-sm">Buscar</button></form></div>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-dim"><tr><th className="p-3">Usuario</th><th>Alta</th><th>Último acceso</th><th>Rol y estado</th></tr></thead>
          <tbody className="divide-y divide-line">{users.map((u) => (
            <tr key={u.id}>
              <td className="p-3">{u.display_name}<p className="text-xs text-dim">{u.email}</p></td>
              <td className="text-xs text-dim">{formatDate(u.created_at)}</td>
              <td className="text-xs text-dim">{u.last_login_at ? formatDate(u.last_login_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td className="py-2">
                <ActionForm action={setUserRoleAction.bind(null, u.id)} className="flex flex-wrap items-center gap-2" submit="Aplicar">
                  <select name="role" defaultValue={u.role} className="field w-auto py-1.5" aria-label="Rol"><option value="viewer">Espectador</option><option value="editor">Edición</option><option value="admin">Administración</option></select>
                  <select name="status" defaultValue={u.status} className="field w-auto py-1.5" aria-label="Estado"><option value="active">Activo</option><option value="blocked">Bloqueado</option></select>
                </ActionForm>
              </td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
