import type { NextConfig } from 'next';

const isDev = process.env.NODE_ENV !== 'production';
// Orígenes adicionales para pruebas locales (p. ej. un CDN de pruebas por HTTP). Vacío en producción.
const extra = (process.env.CSP_EXTRA_SOURCES || '').split(/\s+/).filter(Boolean).join(' ');
const supabaseHost = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).hostname : null;

// Política de seguridad de contenido. Los videos llegan por HLS (blob: vía MediaSource) desde el CDN del proveedor.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https: ${extra}`.trim(),
  // data: lo usa hls.js para crear las pistas de texto del manifiesto (que el reproductor deja apagadas)
  `media-src 'self' data: blob: https: ${extra}`.trim(),
  "font-src 'self' data:",
  // Mux: reproducción (stream/image), subidas directas (storage.googleapis.com / *.mux.com) y analítica
  `connect-src 'self' https://*.mux.com https://storage.googleapis.com https:${isDev ? ' ws: http://localhost:*' : ''} ${extra}`.trim(),
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const config: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: '16mb' }, // imágenes y subtítulos; los videos van directos al proveedor
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'image.mux.com' },
      ...(supabaseHost ? [{ protocol: 'https' as const, hostname: supabaseHost }] : []),
    ],
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [480, 640, 828, 1080, 1280, 1600, 1920, 2560],
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), fullscreen=(self), picture-in-picture=(self)' },
          ...(isDev ? [] : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
        ],
      },
      { source: '/admin/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }, { key: 'Cache-Control', value: 'no-store' }] },
      { source: '/cuenta/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] },
    ];
  },
};

export default config;
