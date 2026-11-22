'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CONSENT_KEY, setConsent } from '@/lib/client/track';

export function ConsentBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try { setShow(!localStorage.getItem(CONSENT_KEY)); } catch { setShow(false); }
  }, []);
  if (!show) return null;
  const choose = (v: 'yes' | 'no') => { setConsent(v); setShow(false); };
  return (
    <div role="dialog" aria-live="polite" aria-label="Preferencias de privacidad" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl animate-rise rounded-2xl border border-line bg-graphite/95 p-4 shadow-2xl backdrop-blur sm:p-5">
      <p className="text-sm text-mist">
        Usamos medición propia y anónima para saber qué se ve y mejorar la plataforma. Con tu permiso, también recordamos tu país aproximado y
        relacionamos tus visionados con tu cuenta para recomendarte mejor. <Link href="/privacidad" className="text-gold-soft underline">Privacidad</Link>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button className="btn btn-gold btn-sm" onClick={() => choose('yes')}>Aceptar</button>
        <button className="btn btn-ghost btn-sm" onClick={() => choose('no')}>Sólo lo esencial</button>
      </div>
    </div>
  );
}
