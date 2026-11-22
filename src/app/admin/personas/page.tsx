import Image from 'next/image';
import Link from 'next/link';
import { sql } from '@/lib/db';
import { ActionForm } from '../ui';
import { Panel, Field, TextArea, ImagePanel } from '../blocks';
import { savePersonAction } from '../actions';

export default async function PeopleAdmin({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const { id } = await searchParams;
  const people = await sql`select p.*, (select count(*)::int from title_credits c where c.person_id = p.id) as credits from people p order by p.name`;
  const current = people.find((p) => p.id === id) ?? null;
  return (
    <div className="grid gap-6">
      <h1 className="display text-3xl">Personas</h1>
      <Panel title="Reparto y equipo">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {people.map((p) => (
            <li key={p.id}><Link href={`/admin/personas?id=${p.id}`} className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${p.id === id ? 'border-gold' : 'border-line hover:border-gold/50'}`}>
              <span className="relative h-10 w-10 overflow-hidden rounded-full bg-graphite-3">{p.photo_url && <Image src={p.photo_url} alt="" fill sizes="40px" className="object-cover" />}</span>
              <span className="text-sm">{p.name}<span className="block text-xs text-dim">{p.credits} créditos</span></span></Link></li>
          ))}
          {!people.length && <li className="text-sm text-dim">Aún no hay personas registradas.</li>}
        </ul>
      </Panel>
      <Panel title={current ? `Editar: ${current.name}` : 'Nueva persona'} actions={current && <Link href="/admin/personas" className="text-sm text-gold-soft">+ Nueva</Link>}>
        <ActionForm key={current?.id ?? 'new'} action={savePersonAction.bind(null, current?.id ?? null)} resetOnOk={!current}>
          <Field label="Nombre" name="name" defaultValue={current?.name} required />
          <TextArea label="Biografía" name="bio" defaultValue={current?.bio} rows={3} />
        </ActionForm>
      </Panel>
      {current && <ImagePanel ownerType="person" ownerId={current.id} kinds={['poster']} title="Fotografía (autorizada)" />}
    </div>
  );
}
