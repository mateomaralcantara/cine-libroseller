import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getCharacter } from '@/lib/catalog/public';
import { episodePath, titlePath } from '@/lib/format';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ title: string; character: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await params;
  const d = await getCharacter(p.title, p.character);
  return d ? { title: `${d.character.name} — ${d.title.title}`, description: d.character.summary ?? undefined, alternates: { canonical: `/personajes/${p.title}/${p.character}` } } : { title: 'Personaje no encontrado' };
}

export default async function CharacterPage({ params }: Props) {
  const p = await params;
  const d = await getCharacter(p.title, p.character);
  if (!d) notFound();
  const { title, character: c, appearances, gallery } = d;
  const relationships = (c.relationships ?? []) as { name: string; relation: string }[];
  return (
    <div className="mx-auto max-w-[1400px] px-4 pb-10 pt-28 sm:px-8 sm:pt-32 lg:px-12">
      <nav aria-label="Ruta" className="text-sm text-mist"><Link href={titlePath(title)} className="hover:text-cream">{title.title}</Link> <span className="text-dim">/</span> Personajes</nav>
      <div className="mt-6 grid gap-10 md:grid-cols-[minmax(0,380px)_1fr]">
        <div className="relative aspect-[3/4] overflow-hidden rounded-3xl bg-graphite ring-1 ring-white/10">
          {c.image_url && <Image src={c.image_url} alt={c.name} fill sizes="380px" className="object-cover" priority />}
        </div>
        <div>
          <p className="eyebrow">Personaje</p>
          <h1 className="display mt-2 text-5xl sm:text-6xl">{c.name}</h1>
          {(c.actor_name || c.digital_identity) && (
            <p className="mt-3 text-mist">{c.actor_name ? <>Interpretado por <strong className="text-cream">{c.actor_name}</strong></> : <>Identidad digital: <strong className="text-cream">{c.digital_identity}</strong></>}
              {c.actor_name && c.digital_identity && <span className="block text-sm text-dim">Identidad digital autorizada: {c.digital_identity}</span>}</p>
          )}
          {c.summary && <p className="mt-6 text-lg text-cream/90">{c.summary}</p>}
          {c.story && (
            <section className="mt-8">
              <h2 className="display text-2xl">Historia</h2>
              {c.first_episode_number && <p className="mt-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">Puede revelar detalles a partir del episodio T{c.first_season_number}:E{c.first_episode_number}.</p>}
              <details className="mt-3 group">
                <summary className="cursor-pointer text-sm text-gold-soft">Mostrar la historia del personaje</summary>
                <p className="mt-3 whitespace-pre-line text-cream/85">{c.story}</p>
              </details>
            </section>
          )}
          {relationships.length > 0 && (
            <section className="mt-8">
              <h2 className="display text-2xl">Relaciones</h2>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">{relationships.map((r) => <li key={r.name} className="rounded-xl border border-line px-4 py-3"><p className="font-medium">{r.name}</p><p className="text-sm text-dim">{r.relation}</p></li>)}</ul>
            </section>
          )}
          {appearances.length > 0 && (
            <section className="mt-8">
              <h2 className="display text-2xl">Aparece en</h2>
              <ul className="mt-3 grid gap-2">{appearances.map((a) => <li key={`${a.season_number}-${a.number}`}><Link href={episodePath(title.slug, a.season_number, a.number)} className="text-gold-soft hover:underline">T{a.season_number}:E{a.number} · {a.name}</Link></li>)}</ul>
            </section>
          )}
          <p className="mt-10 text-xs text-dim">Información oficial de la producción. Las fichas distinguen el canon de la obra de las interpretaciones.</p>
        </div>
      </div>
      {gallery.length > 0 && (
        <ul className="mt-12 grid grid-cols-2 gap-3 lg:grid-cols-4">{gallery.map((g) => <li key={g.url} className="relative aspect-video overflow-hidden rounded-xl"><Image src={g.url} alt={g.alt} fill sizes="25vw" className="object-cover" /></li>)}</ul>
      )}
    </div>
  );
}
