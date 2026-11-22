import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getTitleBySlug } from '@/lib/catalog/public';
import { getViewer } from '@/lib/auth/session';
import { TitlePage } from '@/components/TitlePage';
import { titleMetadata } from '@/lib/seo';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ temporada?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTitleBySlug((await params).slug, 'series');
  return t ? titleMetadata(t) : { title: 'Serie no encontrada' };
}

export default async function SeriesPage({ params, searchParams }: Props) {
  const [{ slug }, { temporada }] = await Promise.all([params, searchParams]);
  const t = await getTitleBySlug(slug, 'series');
  if (!t) notFound();
  return <TitlePage t={t} viewer={await getViewer()} seasonParam={temporada ? `temporada-${temporada}` : undefined} />;
}
