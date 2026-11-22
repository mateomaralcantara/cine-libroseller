import type { Metadata } from 'next';
import Link from 'next/link';
import { requireEditor } from '@/lib/auth/session';
import { isAdmin } from '@/lib/auth/core';
import { Logo } from '@/components/SiteChrome';

export const metadata: Metadata = { title: { default: 'Administración', template: '%s · Admin CINE LIBROSELLER' }, robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const v = await requireEditor();
  const nav: [string, string][] = [
    ['/admin', 'Panel'], ['/admin/titulos', 'Títulos'], ['/admin/videos', 'Videos'], ['/admin/portada', 'Portada'],
    ['/admin/estrenos', 'Estrenos'], ['/admin/personas', 'Personas'], ['/admin/detras-de-camaras', 'Antes / después'],
    ...(isAdmin(v) ? ([['/admin/usuarios', 'Usuarios'], ['/admin/auditoria', 'Auditoría']] as [string, string][]) : []),
  ];
  return (
    <div className="min-h-dvh bg-night lg:grid lg:grid-cols-[230px_1fr]">
      <aside className="border-b border-line bg-ink px-4 py-4 lg:sticky lg:top-0 lg:h-dvh lg:border-b-0 lg:border-r lg:px-5 lg:py-6">
        <div className="flex items-center justify-between lg:block">
          <Logo />
          <p className="hidden text-xs text-dim lg:mt-1 lg:block">Administración</p>
        </div>
        <nav aria-label="Administración" className="mt-4 flex gap-1 overflow-x-auto text-sm lg:mt-8 lg:grid">
          {nav.map(([href, label]) => <Link key={href} href={href} className="shrink-0 rounded-lg px-3 py-2 text-mist hover:bg-white/5 hover:text-cream">{label}</Link>)}
          <Link href="/" className="shrink-0 rounded-lg px-3 py-2 text-gold-soft hover:bg-white/5 lg:mt-4">Ver el sitio ↗</Link>
        </nav>
        <p className="mt-6 hidden text-xs text-dim lg:block">{v.displayName}<br />{v.role === 'admin' ? 'Administración' : 'Edición'}</p>
      </aside>
      <main id="contenido" className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
