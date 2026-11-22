import type { Metadata } from 'next';
import { searchCatalog, allGenres, visibleTitles } from '@/lib/catalog/public';
import { PosterCard } from '@/components/catalog';
import { PageShell, EmptyState } from '@/components/PageShell';
import { TYPE_LABEL } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Buscar', robots: { index: false } };

type Props = { searchParams: Promise<{ q?: string; tipo?: string; genero?: string; anio?: string }> };

export default async function SearchPage({ searchParams }: Props) {
  const sp = await searchParams;
  const q = (sp.q ?? '').slice(0, 100);
  const filters = { type: sp.tipo && TYPE_LABEL[sp.tipo] ? sp.tipo : undefined, genre: sp.genero || undefined, year: sp.anio || undefined };
  const searching = !!(q || filters.type || filters.genre || filters.year);
  const [results, genres] = await Promise.all([searching ? searchCatalog(q, filters) : Promise.resolve([]), allGenres()]);
  const suggestions = searching && !results.length ? await visibleTitles(undefined, undefined, 12) : [];
  return (
    <PageShell eyebrow="Explorar" title="Buscar">
      <form role="search" className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto]" action="/buscar">
        <label className="sr-only" htmlFor="q">Buscar</label>
        <input id="q" name="q" defaultValue={q} autoFocus placeholder="Título, actor, director, personaje, tema o año…" className="field text-lg" />
        <select name="tipo" defaultValue={filters.type ?? ''} className="field" aria-label="Tipo">
          <option value="">Todos los tipos</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="genero" defaultValue={filters.genre ?? ''} className="field" aria-label="Género">
          <option value="">Todos los géneros</option>
          {genres.map((g) => <option key={g.slug} value={g.slug}>{g.name}</option>)}
        </select>
        <button className="btn btn-gold">Buscar</button>
      </form>
      <div className="mt-10" aria-live="polite">
        {searching && results.length > 0 && (
          <>
            <p className="mb-6 text-sm text-dim">{results.length} {results.length === 1 ? 'resultado' : 'resultados'}{q && <> para «{q}»</>}</p>
            <ul role="list" className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 [&>a]:w-auto">{results.map((t) => <PosterCard key={t.id} t={t} />)}</ul>
          </>
        )}
        {searching && !results.length && (
          <>
            <EmptyState title="No encontramos obras que coincidan">Sólo mostramos producciones reales de nuestro catálogo. Prueba con otras palabras{suggestions.length ? ' o descubre lo que ya está disponible:' : '.'}</EmptyState>
            {suggestions.length > 0 && <ul role="list" className="mt-10 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 [&>a]:w-auto">{suggestions.map((t) => <PosterCard key={t.id} t={t} />)}</ul>}
          </>
        )}
        {!searching && <p className="text-mist">Busca por título, género, director, actor, personaje, tema, palabras de la sinopsis, año o país.</p>}
      </div>
    </PageShell>
  );
}
