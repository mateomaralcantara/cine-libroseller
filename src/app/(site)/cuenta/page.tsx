import type { Metadata } from 'next';
import { requireViewer, sessionToken } from '@/lib/auth/session';
import { sql } from '@/lib/db';
import { sha256 } from '@/lib/auth/core';
import { PageShell } from '@/components/PageShell';
import { PreferencesForm } from './forms';
import { logoutAction, revokeOtherSessions } from './actions';
import { formatDate } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mi cuenta', robots: { index: false } };

const DEVICE: Record<string, string> = { desktop: 'Computadora', mobile: 'Teléfono', tablet: 'Tableta', tv: 'Televisor', unknown: 'Dispositivo' };

export default async function AccountPage() {
  const viewer = await requireViewer('/cuenta');
  const [[prefs], [profile], sessions, [vp]] = await Promise.all([
    sql`select * from viewer_preferences where viewer_profile_id = ${viewer.viewerProfileId}`,
    sql`select marketing_consent_at, created_at from profiles where id = ${viewer.id}`,
    sql`select id, device, user_agent, created_at, last_seen_at, token_hash from user_sessions where profile_id = ${viewer.id} and revoked_at is null and expires_at > now() order by last_seen_at desc`,
    sql`select name from viewer_profiles where id = ${viewer.viewerProfileId}`,
  ]);
  const current = sha256((await sessionToken()) || '');
  return (
    <PageShell eyebrow="Mi cuenta" title={viewer.displayName} intro={<>{viewer.email} · Miembro desde {formatDate(profile.created_at)}</>}>
      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <section className="card p-6 sm:p-8" aria-labelledby="h-prefs">
          <h2 id="h-prefs" className="display mb-5 text-2xl">Preferencias</h2>
          <PreferencesForm prefs={prefs as never} profileName={vp?.name ?? viewer.displayName} marketing={!!profile.marketing_consent_at} />
        </section>
        <section className="card p-6 sm:p-8" aria-labelledby="h-ses">
          <h2 id="h-ses" className="display mb-5 text-2xl">Dispositivos y sesiones</h2>
          <ul className="grid gap-3 text-sm">
            {sessions.map((s) => (
              <li key={s.id} className="rounded-xl border border-line px-4 py-3">
                <p className="font-medium">{DEVICE[s.device] ?? 'Dispositivo'} {s.token_hash === current && <span className="chip chip-gold ml-2">Este dispositivo</span>}</p>
                <p className="mt-1 truncate text-xs text-dim">{s.user_agent}</p>
                <p className="text-xs text-dim">Último uso: {formatDate(s.last_seen_at, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex flex-wrap gap-3">
            {sessions.length > 1 && <form action={revokeOtherSessions}><button className="btn btn-ghost btn-sm">Cerrar las demás sesiones</button></form>}
            <form action={logoutAction}><button className="btn btn-ghost btn-sm">Cerrar sesión</button></form>
          </div>
        </section>
      </div>
    </PageShell>
  );
}
