import { sql, type Tx } from './db';

export async function audit(actorId: string | null, action: string, entityType: string | null, entityId: string | null, detail?: unknown, db: Tx = sql) {
  await db`insert into admin_audit_logs (actor_id, action, entity_type, entity_id, detail)
    values (${actorId}, ${action}, ${entityType}, ${entityId}, ${detail === undefined ? null : db.json(detail as never)})`;
}

/** Guarda una instantánea del registro antes de modificarlo (historial de versiones de contenido). */
export async function snapshot(entityType: 'title' | 'season' | 'episode', entityId: string, actorId: string | null, db: Tx = sql) {
  const table = entityType === 'title' ? 'titles' : entityType === 'season' ? 'seasons' : 'episodes';
  const [row] = await db`select * from ${db(table)} where id = ${entityId}`;
  if (row) {
    await db`insert into content_revisions (entity_type, entity_id, snapshot, created_by)
      values (${entityType}, ${entityId}, ${db.json(JSON.parse(JSON.stringify(row)))}, ${actorId})`;
  }
}
