-- Row Level Security.
--
-- La aplicación accede a la base desde el servidor (rol con privilegios de servicio) y aplica la
-- autorización en código. Supabase, además, publica el esquema `public` mediante su API REST con la
-- clave anónima: por eso TODAS las tablas tienen RLS activado. Sin una política explícita, los roles
-- `anon` y `authenticated` no pueden leer ni escribir nada.
--
-- Sólo se abren, en lectura, los datos de catálogo ya publicados.
-- Únicamente se tocan las tablas de esta plataforma: nunca tablas de otras aplicaciones.

do $$
declare t text;
begin
  foreach t in array array['profiles', 'user_sessions', 'viewer_profiles', 'viewer_preferences', 'genres', 'categories', 'titles', 'title_genres', 'title_categories', 'collections', 'collection_items', 'seasons', 'episodes', 'people', 'characters', 'character_appearances', 'title_credits', 'media_images', 'media_comparisons', 'video_assets', 'video_encodings', 'video_tracks', 'subtitle_tracks', 'trailers', 'media_upload_jobs', 'watch_progress', 'watch_history', 'playback_events', 'watchlists', 'watchlist_items', 'release_schedules', 'content_availability', 'content_rights', 'featured_content', 'homepage_sections', 'homepage_section_items', 'products', 'orders', 'payments', 'subscriptions', 'access_entitlements', 'sponsors', 'sponsorship_placements', 'newsletter_subscriptions', 'release_notifications', 'contact_requests', 'admin_audit_logs', 'content_revisions', 'system_settings', 'webhook_events']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- El propietario de las tablas (rol de la aplicación) debe poder operar pese a FORCE RLS.
do $$
declare t text;
begin
  foreach t in array array['profiles', 'user_sessions', 'viewer_profiles', 'viewer_preferences', 'genres', 'categories', 'titles', 'title_genres', 'title_categories', 'collections', 'collection_items', 'seasons', 'episodes', 'people', 'characters', 'character_appearances', 'title_credits', 'media_images', 'media_comparisons', 'video_assets', 'video_encodings', 'video_tracks', 'subtitle_tracks', 'trailers', 'media_upload_jobs', 'watch_progress', 'watch_history', 'playback_events', 'watchlists', 'watchlist_items', 'release_schedules', 'content_availability', 'content_rights', 'featured_content', 'homepage_sections', 'homepage_section_items', 'products', 'orders', 'payments', 'subscriptions', 'access_entitlements', 'sponsors', 'sponsorship_placements', 'newsletter_subscriptions', 'release_notifications', 'contact_requests', 'admin_audit_logs', 'content_revisions', 'system_settings', 'webhook_events']
  loop
    execute format('create policy app_owner_all on %I for all to current_user using (true) with check (true)', t);
  end loop;
end $$;

-- Políticas de lectura pública (sólo si existen los roles de Supabase)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') and exists (select 1 from pg_roles where rolname = 'authenticated') then
    create policy public_read_titles on titles for select to anon, authenticated
      using (status = 'published' and (publish_at is null or publish_at <= now()));
    create policy public_read_seasons on seasons for select to anon, authenticated
      using (status = 'published');
    create policy public_read_episodes on episodes for select to anon, authenticated
      using (status = 'published' and (publish_at is null or publish_at <= now()));
    create policy public_read_genres on genres for select to anon, authenticated using (true);
    create policy public_read_categories on categories for select to anon, authenticated using (true);
    create policy public_read_title_genres on title_genres for select to anon, authenticated using (true);
    create policy public_read_people on people for select to anon, authenticated using (true);
    create policy public_read_characters on characters for select to anon, authenticated using (is_published);
    create policy public_read_comparisons on media_comparisons for select to anon, authenticated using (approved_for_public);
    create policy public_read_releases on release_schedules for select to anon, authenticated using (is_public);
  end if;
end $$;
