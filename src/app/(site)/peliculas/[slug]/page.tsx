import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTitleBySlug } from '@/lib/catalog/public';
import { getViewer } from '@/lib/auth/session';
import { TitlePage } from '@/components/TitlePage';
import { titleMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTitleBySlug((await params).slug, 'film');
  return t ? titleMetadata(t) : { title: 'Película no encontrada' };
}

export default async function FilmPage({ params }: Props) {
  const t = await getTitleBySlug((await params).slug, 'film');
  if (!t) notFound();
  return <TitlePage t={t} viewer={await getViewer()} />;
}
