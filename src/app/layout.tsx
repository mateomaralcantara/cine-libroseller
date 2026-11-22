import type { Metadata, Viewport } from 'next';
import './globals.css';
import { env } from '@/lib/env';

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: 'CINE LIBROSELLER — El futuro del cine comienza aquí', template: '%s · CINE LIBROSELLER' },
  description: 'Películas, series y producciones cinematográficas originales de Cine LibroSeller Studios. Drama, cine filosófico, suspenso y producciones híbridas.',
  applicationName: 'CINE LIBROSELLER',
  openGraph: { siteName: 'CINE LIBROSELLER', locale: 'es_DO', type: 'website' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: '#060608',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-scroll-behavior="smooth">
      <body className="min-h-dvh">
        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-full focus:bg-cream focus:px-4 focus:py-2 focus:text-ink">
          Saltar al contenido
        </a>
        {children}
      </body>
    </html>
  );
}
