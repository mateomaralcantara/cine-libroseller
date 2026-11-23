// Imagen de marca para compartir las páginas que no tienen portada propia (inicio sin destacado, listados…).
import { ImageResponse } from 'next/og';

export const alt = 'CINE LIBROSELLER — El futuro del cine comienza aquí';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          background: 'radial-gradient(ellipse at 50% 0%, #3a2e17 0%, #120f0a 45%, #060608 100%)', color: '#f3ead8',
        }}
      >
        <div style={{ fontSize: 26, letterSpacing: 10, color: '#c8a25a', textTransform: 'uppercase' }}>Cine LibroSeller Studios presenta</div>
        <div style={{ display: 'flex', marginTop: 28, fontSize: 104, fontWeight: 700, letterSpacing: 4 }}>
          <span>CINE&nbsp;</span><span style={{ color: '#c8a25a' }}>LIBROSELLER</span>
        </div>
        <div style={{ marginTop: 26, fontSize: 40, fontStyle: 'italic', color: 'rgba(243,234,216,0.85)' }}>El futuro del cine comienza aquí.</div>
        <div style={{ display: 'flex', marginTop: 54, width: 160, height: 3, background: '#c8a25a' }} />
      </div>
    ),
    size,
  );
}
