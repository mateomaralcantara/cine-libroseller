'use client';
// Último recurso si falla el layout raíz: documento propio, sin depender de estilos globales.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const dev = process.env.NODE_ENV !== 'production';
  const message = error instanceof Error ? error.message : String(error);
  return (
    <html lang="es">
      <body style={{ margin: 0, minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#060608', color: '#f4efe4', fontFamily: 'system-ui, sans-serif', textAlign: 'center', padding: 24 }}>
        <title>Error · CINE LIBROSELLER</title>
        <div style={{ maxWidth: 560 }}>
          <p style={{ color: '#c8a25a', letterSpacing: '0.2em', fontSize: 12, textTransform: 'uppercase' }}>CINE LIBROSELLER</p>
          <h1 style={{ fontFamily: 'Georgia, serif', fontWeight: 400, fontSize: 36 }}>Algo interrumpió la función</h1>
          <p style={{ color: '#b9b3a6' }}>No pudimos cargar el sitio. Inténtalo de nuevo en unos segundos.</p>
          {dev && message && <p style={{ marginTop: 20, padding: 16, borderRadius: 12, border: '1px solid #ec6f6a66', background: '#ec6f6a1a', color: '#ec6f6a', textAlign: 'left', fontSize: 14 }}>{message}</p>}
          <button onClick={() => retry()} style={{ marginTop: 24, padding: '12px 22px', borderRadius: 999, border: 0, background: '#c8a25a', color: '#060608', fontWeight: 600, cursor: 'pointer' }}>Reintentar</button>
        </div>
      </body>
    </html>
  );
}
