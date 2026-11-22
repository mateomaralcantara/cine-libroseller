'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function MobileNav({ items }: { items: { href: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open]);
  return (
    <div className="lg:hidden">
      <button className="rounded-full p-2.5 text-cream hover:bg-white/10" aria-expanded={open} aria-controls="menu-movil" aria-label="Menú" onClick={() => setOpen((v) => !v)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <nav id="menu-movil" aria-label="Menú móvil" className="fixed inset-x-0 top-16 z-50 h-[calc(100dvh-4rem)] animate-fade bg-ink/97 px-6 py-8 backdrop-blur-xl sm:top-20">
          <ul className="grid gap-1">
            {items.map((i) => (
              <li key={i.href}>
                <Link href={i.href} className={`display block rounded-xl px-3 py-3 text-2xl ${path === i.href ? 'text-gold' : 'text-cream'}`}>{i.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
}
