import Link from 'next/link';
import type { PlaybackDenied, PlaybackGranted } from '@/lib/playback';
import { Player } from './player/Player';

/** Modo cine: reproductor a pantalla completa, sin distracciones. */
export function WatchScreen({ result, signedIn, loginNext }: { result: PlaybackDenied | PlaybackGranted; signedIn: boolean; loginNext: string }) {
  if (!result.ok) {
    return (
      <main id="contenido" className="grid min-h-dvh place-items-center bg-black p-6 text-center">
        <div className="max-w-md">
          <p className="eyebrow">CINE LIBROSELLER</p>
          <h1 className="display mt-4 text-3xl">{result.reason === 'processing' ? 'Casi listo' : 'No disponible'}</h1>
          <p className="mt-3 text-mist">{result.message}</p>
          <div className="mt-6 flex justify-center gap-3">
            {result.reason === 'login_required' && <Link className="btn btn-gold" href={`/cuenta/entrar?next=${encodeURIComponent(loginNext)}`}>Iniciar sesión</Link>}
            {result.reason === 'login_required' && <Link className="btn btn-ghost" href={`/cuenta/registro?next=${encodeURIComponent(loginNext)}`}>Crear cuenta gratis</Link>}
            <Link className="btn btn-ghost" href="/">Volver al inicio</Link>
          </div>
        </div>
      </main>
    );
  }
  const { titleId: _t, ...source } = result; // eslint-disable-line @typescript-eslint/no-unused-vars
  return (
    <main id="contenido" className="bg-black">
      <h1 className="sr-only">{result.heading}{result.subheading ? ` — ${result.subheading}` : ''}</h1>
      <Player source={source} signedIn={signedIn} variant="cinema" />
    </main>
  );
}
