import Link from 'next/link';
import { getViewer } from '@/lib/auth/session';
import { canEdit } from '@/lib/auth/core';
import { MobileNav } from './MobileNav';

const NAV = [
  { href: '/', label: 'Inicio' },
  { href: '/series', label: 'Series' },
  { href: '/peliculas', label: 'Películas' },
  { href: '/estrenos', label: 'Próximos estrenos' },
  { href: '/detras-de-camaras', label: 'Detrás de cámaras' },
];

export function Logo({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className={`group inline-flex items-baseline gap-2 ${className}`} aria-label="CINE LIBROSELLER, inicio">
      <span className="display text-xl font-semibold tracking-[0.18em] text-cream sm:text-2xl">CINE</span>
      <span className="text-[0.62rem] font-semibold tracking-[0.42em] text-gold sm:text-[0.68rem]">LIBROSELLER</span>
    </Link>
  );
}

export async function SiteHeader({ overlay = false }: { overlay?: boolean }) {
  const viewer = await getViewer();
  return (
    <header className={`${overlay ? 'absolute' : 'sticky'} inset-x-0 top-0 z-40 ${overlay ? 'bg-gradient-to-b from-ink/90 via-ink/40 to-transparent' : 'border-b border-line/60 bg-ink/85 backdrop-blur-xl'}`}>
      <div className="mx-auto flex h-16 max-w-[1680px] items-center gap-6 px-4 sm:h-20 sm:px-8 lg:px-12">
        <Logo />
        <nav aria-label="Principal" className="hidden flex-1 items-center gap-6 text-sm text-mist lg:flex">
          {NAV.slice(1).map((n) => (
            <Link key={n.href} href={n.href} className="transition hover:text-cream">{n.label}</Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <Link href="/buscar" className="rounded-full p-2.5 text-mist transition hover:bg-white/10 hover:text-cream" aria-label="Buscar">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </Link>
          {viewer ? (
            <>
              <Link href="/mi-lista" className="hidden text-sm text-mist transition hover:text-cream sm:inline">Mi lista</Link>
              {canEdit(viewer) && <Link href="/admin" className="hidden text-sm text-gold-soft transition hover:text-gold sm:inline">Administración</Link>}
              <Link href="/cuenta" className="grid h-9 w-9 place-items-center rounded-full bg-gold/90 text-sm font-semibold text-ink" aria-label={`Mi cuenta (${viewer.displayName})`}>
                {viewer.displayName.slice(0, 1).toUpperCase()}
              </Link>
            </>
          ) : (
            <Link href="/cuenta/entrar" className="btn btn-ghost btn-sm">Entrar</Link>
          )}
          <MobileNav items={[...NAV, ...(viewer ? [{ href: '/mi-lista', label: 'Mi lista' }] : []), { href: '/buscar', label: 'Buscar' }]} />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line/60 bg-night">
      <div className="mx-auto grid max-w-[1680px] gap-10 px-4 py-14 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr] lg:px-12">
        <div>
          <Logo />
          <p className="display mt-4 text-2xl italic text-cream/90">El futuro del cine comienza aquí.</p>
          <p className="mt-3 max-w-md text-sm text-dim">Películas y series originales de Cine LibroSeller Studios. Producción independiente con CineViral.</p>
        </div>
        <nav aria-label="Explorar" className="grid content-start gap-2 text-sm text-mist">
          <span className="eyebrow mb-1">Explorar</span>
          <Link href="/series" className="hover:text-cream">Series</Link>
          <Link href="/peliculas" className="hover:text-cream">Películas</Link>
          <Link href="/estrenos" className="hover:text-cream">Próximos estrenos</Link>
          <Link href="/detras-de-camaras" className="hover:text-cream">Detrás de cámaras</Link>
        </nav>
        <nav aria-label="Información" className="grid content-start gap-2 text-sm text-mist">
          <span className="eyebrow mb-1">Información</span>
          <Link href="/privacidad" className="hover:text-cream">Privacidad y datos</Link>
          <a href="https://libroseller.com" rel="noopener" className="hover:text-cream">LibroSeller</a>
          <Link href="/cuenta" className="hover:text-cream">Mi cuenta</Link>
        </nav>
      </div>
      <p className="border-t border-line/40 px-4 py-6 text-center text-xs text-dim">© {new Date().getFullYear()} Cine LibroSeller Studios · República Dominicana</p>
    </footer>
  );
}
