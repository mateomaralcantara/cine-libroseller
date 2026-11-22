import { sql } from '@/lib/db';
import { requireAdmin } from '@/lib/auth/session';
import { formatDate } from '@/lib/format';

export default async function AuditAdmin() {
  await requireAdmin();
  const rows = await sql`select a.*, p.display_name from admin_audit_logs a left join profiles p on p.id = a.actor_id order by a.created_at desc limit 300`;
  return (
    <div className="grid gap-6">
      <h1 className="display text-3xl">Auditoría</h1>
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line text-xs uppercase text-dim"><tr><th className="p-3">Fecha</th><th>Persona</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
          <tbody className="divide-y divide-line">{rows.map((r) => (
            <tr key={r.id}><td className="whitespace-nowrap p-3 text-xs text-dim">{formatDate(r.created_at, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
              <td>{r.display_name ?? 'Sistema'}</td><td><code className="text-xs">{r.action}</code></td><td className="text-xs text-dim">{r.entity_type} {r.entity_id?.slice(0, 8)}</td>
              <td className="max-w-md truncate font-mono text-xs text-dim">{r.detail ? JSON.stringify(r.detail) : ''}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  );
}
