'use client';
// Pantalla de error de las páginas (en español). En desarrollo muestra el motivo; en producción, un mensaje genérico.
import Link from 'next/link';

export default function ErrorPage({ error, retry }: { error: unknown; retry: () => void }) {
  const dev = process.env.NODE_ENV !== 'production';
  const message = error instanceof Error ? error.message : String(error);
  const digest = error instanceof Error ? (error as Error & { digest?: string }).digest : undefined;
  return (
    <main id="contenido" className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_50%_0%,rgba(200,162,90,0.12),transparent_60%)] px-6 text-center">
      <div className="max-w-xl">
        <p className="eyebrow">Error · Corte inesperado</p>
        <h1 className="display mt-4 text-4xl">No pudimos cargar esta página</h1>
        <p className="mt-3 text-mist">Puede ser un problema temporal. Inténtalo de nuevo en unos segundos.</p>
        {dev && message && <p className="mt-5 rounded-xl border border-bad/40 bg-bad/10 p-4 text-left text-sm text-bad">{message}</p>}
        {!dev && digest && <p className="mt-3 text-xs text-dim">Referencia del error: {digest}</p>}
        <div className="mt-8 flex justify-center gap-3">
          <button className="btn btn-gold" onClick={() => retry()}>Reintentar</button>
          <Link className="btn btn-ghost" href="/">Ir al inicio</Link>
        </div>
      </div>
    </main>
  );
}
