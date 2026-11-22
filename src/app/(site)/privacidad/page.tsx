import type { Metadata } from 'next';
import { PageShell } from '@/components/PageShell';

export const metadata: Metadata = { title: 'Privacidad y datos', alternates: { canonical: '/privacidad' } };

export default function Privacy() {
  return (
    <PageShell eyebrow="Información" title="Privacidad y datos" intro="Resumen de cómo trata CINE LIBROSELLER tu información. El texto legal definitivo debe revisarlo la asesoría jurídica de la empresa.">
      <div className="grid max-w-3xl gap-8 text-cream/85">
        <section><h2 className="display text-2xl text-cream">Qué recogemos</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5">
            <li>Si creas una cuenta: nombre, email y una contraseña cifrada (nunca la guardamos en claro).</li>
            <li>Tu progreso de reproducción, tu lista y tu historial, para que continúes en cualquier dispositivo.</li>
            <li>Medición de uso: qué se reproduce y durante cuánto tiempo, el tipo de dispositivo y la fuente de la visita. No guardamos tu dirección IP en la analítica.</li>
            <li>Sólo con tu consentimiento: país aproximado y relación de la medición con tu perfil para recomendarte obras.</li>
          </ul></section>
        <section><h2 className="display text-2xl text-cream">Comunicaciones</h2>
          <p className="mt-3">Sólo te escribimos si lo pides expresamente (avisos de estreno o novedades). Cada correo incluye un enlace para darte de baja.</p></section>
        <section><h2 className="display text-2xl text-cream">Pagos</h2>
          <p className="mt-3">Cuando existan contenidos de pago, los gestionará un proveedor especializado. CINE LIBROSELLER no almacena números de tarjeta.</p></section>
        <section><h2 className="display text-2xl text-cream">Tus derechos</h2>
          <p className="mt-3">Puedes consultar, corregir o eliminar tus datos y retirar tus consentimientos en cualquier momento desde «Mi cuenta» o escribiendo al equipo de Cine LibroSeller Studios.</p></section>
        <section><h2 className="display text-2xl text-cream">Contenido con IA</h2>
          <p className="mt-3">Cada obra indica si contiene imágenes o sonido generados o modificados con inteligencia artificial. Sólo publicamos transformaciones autorizadas por las personas que aparecen y por los titulares de derechos.</p></section>
      </div>
    </PageShell>
  );
}
