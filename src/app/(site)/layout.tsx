import { SiteHeader, SiteFooter } from '@/components/SiteChrome';
import { ConsentBanner } from '@/components/ConsentBanner';
import { DemoBanner } from '@/components/DemoBanner';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <DemoBanner />
      <SiteHeader overlay />
      <main id="contenido">{children}</main>
      <SiteFooter />
      <ConsentBanner />
    </>
  );
}
