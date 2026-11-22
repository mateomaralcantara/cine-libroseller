import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/auth/session';
import { LoginForm } from '../forms';

export const metadata: Metadata = { title: 'Entrar', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next = '/' } = await searchParams;
  if (await getViewer()) redirect(next.startsWith('/') ? next : '/');
  return (
    <div className="grid min-h-[80svh] place-items-center px-4 pt-24">
      <div className="w-full max-w-md">
        <h1 className="display text-center text-4xl">Bienvenido de nuevo</h1>
        <p className="mt-2 text-center text-mist">Continúa donde lo dejaste, en cualquier dispositivo.</p>
        <div className="card mt-8 p-6 sm:p-8"><LoginForm next={next} /></div>
      </div>
    </div>
  );
}
