import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { ConsentBanner } from '@/components/ConsentBanner';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader overlay />
      <main id="contenido">{children}</main>
      <SiteFooter />
      <ConsentBanner />
    </>
  );
}
