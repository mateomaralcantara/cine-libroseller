import { describe, it, expect } from 'vitest';
import { clip, shareImage, DEFAULT_SHARE_IMAGE, pageMetadata } from '../../src/lib/seo';

describe('vista previa al compartir', () => {
  it('recorta sin partir palabras', () => {
    const out = clip('Siete desconocidos reciben la misma invitación a un banquete en lo alto de una montaña', 50)!;
    expect(out).toBe('Siete desconocidos reciben la misma invitación a…');
    expect(out.length).toBeLessThanOrEqual(50);
    expect(clip('  corto  ', 50)).toBe('corto');
    expect(clip(null, 10)).toBeUndefined();
  });

  it('usa la ruta /og con JPEG 1200×630, o la imagen de marca si no hay portada', () => {
    const img = shareImage({ url: 'https://x.supabase.co/storage/v1/object/public/media/a b.jpg' }, 'Portada');
    expect(img.url).toBe('/og?src=' + encodeURIComponent('https://x.supabase.co/storage/v1/object/public/media/a b.jpg'));
    expect(img).toMatchObject({ width: 1200, height: 630, type: 'image/jpeg', alt: 'Portada' });
    expect(shareImage(null, 'x')).toBe(DEFAULT_SHARE_IMAGE);
  });

  it('añade la marca al título en redes y marca summary_large_image', () => {
    const m = pageMetadata({ title: 'Series', path: '/series' });
    expect(m.openGraph?.title).toBe('Series · CINE LIBROSELLER');
    expect((m.twitter as { card: string }).card).toBe('summary_large_image');
  });
});
