import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="contenido" className="grid min-h-dvh place-items-center bg-[radial-gradient(ellipse_at_50%_0%,rgba(200,162,90,0.12),transparent_60%)] px-6 text-center">
      <div>
        <p className="eyebrow">404 · Fuera de plano</p>
        <h1 className="display mt-4 text-5xl">Esta escena no existe</h1>
        <p className="mt-3 text-mist">La página que buscas no está publicada o cambió de lugar.</p>
        <div className="mt-8 flex justify-center gap-3"><Link className="btn btn-gold" href="/">Ir al inicio</Link><Link className="btn btn-ghost" href="/buscar">Buscar</Link></div>
      </div>
    </main>
  );
}
