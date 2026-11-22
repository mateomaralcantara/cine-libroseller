import { sql } from '@/lib/db';

/** Aviso visible mientras haya contenido de demostración cargado (npm run demo:seed). */
export async function DemoBanner() {
  let demo: unknown;
  try {
    [demo] = await sql`select 1 from system_settings where key = 'demo'`;
  } catch {
    return null; // sin base de datos (p. ej. al compilar) no se muestra la franja
  }
  if (!demo) return null;
  return (
    <div role="note" className="fixed inset-x-0 top-0 z-[45] bg-gold px-4 py-1 text-center text-xs font-semibold text-ink">
      Modo demostración: obras, imágenes y videos simulados. Se eliminan con «npm run demo:clear».
    </div>
  );
}
