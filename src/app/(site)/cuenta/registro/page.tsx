import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/session';
import { RegisterForm } from '../forms';

export const metadata: Metadata = { title: 'Crear cuenta', robots: { index: false } };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = '/' } = await searchParams;
  if (await getViewer()) redirect('/');
  return (
    <div className="grid min-h-[80svh] place-items-center px-4 pt-24">
      <div className="w-full max-w-md">
        <h1 className="display text-center text-4xl">Crea tu cuenta</h1>
        <p className="mt-2 text-center text-mist">Gratis. Guarda tu progreso, crea tu lista y recibe recomendaciones. Para ver contenido gratuito no necesitas cuenta.</p>
        <div className="card mt-8 p-6 sm:p-8"><RegisterForm next={next} /></div>
      </div>
    </div>
  );
}
