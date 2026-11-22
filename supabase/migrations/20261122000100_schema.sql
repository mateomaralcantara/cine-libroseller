-- CINE LIBROSELLER — esquema inicial (Fase 1 + bases de fases posteriores)
-- Compatible con Supabase PostgreSQL (15+) y PostgreSQL 16 local.

create extension if not exists pgcrypto;

-- Utilidad: mantener updated_at
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Estados editoriales compartidos por títulos, temporadas y episodios
do $$ begin
  create type publication_status as enum ('draft', 'in_review', 'scheduled', 'published', 'withdrawn', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type access_level as enum ('free', 'registered', 'premium');
exception when duplicate_object then null; end $$;

-- ============================================================ USUARIOS
create table profiles (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  display_name text not null,
  role text not null default 'viewer' check (role in ('viewer', 'editor', 'admin')),
  status text not null default 'active' check (status in ('active', 'blocked')),
  failed_logins int not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  marketing_consent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_key on profiles (lower(email));

create table user_sessions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  device text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index user_sessions_profile_idx on user_sessions (profile_id);

create table viewer_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  avatar_url text,
  language text not null default 'es',
  is_kids boolean not null default false,
  maturity_limit text,               -- preparado para controles parentales futuros
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index viewer_profiles_profile_idx on viewer_profiles (profile_id);
create unique index viewer_profiles_one_default on viewer_profiles (profile_id) where is_default;

create table viewer_preferences (
  viewer_profile_id uuid primary key references viewer_profiles(id) on delete cascade,
  subtitle_language text,
  subtitle_size text not null default 'medium' check (subtitle_size in ('small', 'medium', 'large')),
  autoplay_next boolean not null default true,
  autoplay_previews boolean not null default true,
  data_saver boolean not null default false,
  preferred_genres text[] not null default '{}',
  updated_at timestamptz not null default now()
);

-- ============================================================ CATÁLOGO
create table genres (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  position int not null default 0
);

create table categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  position int not null default 0
);

create table titles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  type text not null check (type in ('movie', 'series', 'short', 'documentary', 'special')),
  title text not null,
  international_title text,
  tagline text,
  synopsis_short text,
  synopsis_long text,
  production_date date,
  release_date date,
  runtime_minutes int check (runtime_minutes is null or runtime_minutes > 0),
  country text,
  original_language text not null default 'es',
  languages text[] not null default '{es}',
  age_rating text,
  production_company text not null default 'Cine LibroSeller Studios',
  status publication_status not null default 'draft',
  publish_at timestamptz,
  published_at timestamptz,
  access access_level not null default 'free',
  ai_disclosure text not null default 'none' check (ai_disclosure in ('none', 'assisted', 'modified', 'generated')),
  ai_disclosure_note text,
  source_book jsonb,                  -- libro original (LibroSeller): título, autor, portada, editorial, relación, enlace
  related_links jsonb not null default '[]',
  seo_title text,
  seo_description text,
  external_ref text unique,          -- identificador de producción en CineViral
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index titles_status_idx on titles (status, publish_at);
create index titles_type_idx on titles (type);

create table title_genres (
  title_id uuid not null references titles(id) on delete cascade,
  genre_id uuid not null references genres(id) on delete cascade,
  primary key (title_id, genre_id)
);
create index title_genres_genre_idx on title_genres (genre_id);

create table title_categories (
  title_id uuid not null references titles(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (title_id, category_id)
);
create index title_categories_category_idx on title_categories (category_id);

create table collections (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);

create table collection_items (
  collection_id uuid not null references collections(id) on delete cascade,
  title_id uuid not null references titles(id) on delete cascade,
  position int not null default 0,
  primary key (collection_id, title_id)
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  number int not null check (number > 0),
  name text,
  synopsis text,
  release_date date,
  status publication_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (title_id, number)
);

create table episodes (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons(id) on delete cascade,
  title_id uuid not null references titles(id) on delete cascade,
  number int not null check (number > 0),
  name text not null,
  synopsis text,
  runtime_minutes int check (runtime_minutes is null or runtime_minutes > 0),
  release_date date,
  status publication_status not null default 'draft',
  publish_at timestamptz,
  published_at timestamptz,
  access access_level not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (season_id, number)
);
create index episodes_title_idx on episodes (title_id, status);

create table people (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  bio text,
  photo_url text,
  created_at timestamptz not null default now()
);

create table characters (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  slug text not null,
  name text not null,
  summary text,
  story text,
  actor_id uuid references people(id) on delete set null,
  digital_identity text,             -- identidad digital autorizada, si aplica
  relationships jsonb not null default '[]',
  image_url text,
  first_episode_id uuid references episodes(id) on delete set null,  -- evita spoilers
  is_published boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (title_id, slug)
);

create table character_appearances (
  character_id uuid not null references characters(id) on delete cascade,
  episode_id uuid not null references episodes(id) on delete cascade,
  primary key (character_id, episode_id)
);

create table title_credits (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  role text not null check (role in ('director', 'writer', 'cast', 'producer', 'executive_producer', 'composer', 'cinematographer', 'editor', 'vfx', 'other')),
  character_id uuid references characters(id) on delete set null,
  credit_note text,
  position int not null default 0
);
create index title_credits_title_idx on title_credits (title_id);
create index title_credits_person_idx on title_credits (person_id);

-- ============================================================ CONTENIDO AUDIOVISUAL
create table media_images (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('title', 'season', 'episode', 'person', 'character', 'release')),
  owner_id uuid not null,
  kind text not null check (kind in ('poster', 'backdrop', 'banner', 'logo', 'thumbnail', 'still', 'gallery', 'behind_scenes', 'social')),
  url text not null,
  storage_path text,
  width int,
  height int,
  alt_text text not null default '',
  position int not null default 0,
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index media_images_owner_idx on media_images (owner_type, owner_id, kind);

-- Comparaciones antes/después (portafolio de producción híbrida). Sólo se muestran aprobadas.
create table media_comparisons (
  id uuid primary key default gen_random_uuid(),
  title_id uuid references titles(id) on delete cascade,
  label text not null,
  description text,
  category text not null default 'vfx' check (category in ('actor', 'set', 'character_design', 'storyboard', 'vfx')),
  before_url text not null,
  after_url text not null,
  rights_note text,
  approved_for_public boolean not null default false,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table video_assets (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('episode', 'title', 'trailer')),
  owner_id uuid not null,
  provider text not null check (provider in ('mux', 'link')),
  provider_asset_id text,
  provider_upload_id text,
  playback_id text,
  playback_policy text not null default 'public' check (playback_policy in ('public', 'signed')),
  source_url text,                   -- sólo provider=link: HLS/MP4 alojado en un CDN externo
  status text not null default 'pending' check (status in ('pending', 'uploading', 'processing', 'in_review', 'ready', 'published', 'error')),
  error_message text,
  duration_seconds numeric(10, 2),
  aspect_ratio text,
  max_resolution text,
  version int not null default 1,
  is_current boolean not null default false,
  original_filename text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index video_assets_owner_idx on video_assets (owner_type, owner_id);
create unique index video_assets_one_current on video_assets (owner_type, owner_id) where is_current;
create unique index video_assets_provider_asset on video_assets (provider, provider_asset_id) where provider_asset_id is not null;
create unique index video_assets_provider_upload on video_assets (provider, provider_upload_id) where provider_upload_id is not null;

create table video_encodings (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  rendition text not null,
  width int,
  height int,
  bitrate int,
  codec text,
  unique (video_asset_id, rendition)
);

create table video_tracks (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  kind text not null check (kind in ('video', 'audio')),
  language text,
  name text,
  provider_track_id text,
  is_primary boolean not null default false
);
create index video_tracks_asset_idx on video_tracks (video_asset_id);

-- Los subtítulos pertenecen a la obra (no al archivo), para sobrevivir a la sustitución del video.
create table subtitle_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('episode', 'title', 'trailer')),
  owner_id uuid not null,
  language text not null,
  label text not null,
  kind text not null default 'subtitles' check (kind in ('subtitles', 'captions')),
  url text not null,
  storage_path text,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index subtitle_tracks_owner_idx on subtitle_tracks (owner_type, owner_id);

create table trailers (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  name text not null,
  kind text not null default 'trailer' check (kind in ('trailer', 'teaser', 'clip', 'behind_the_scenes', 'interview', 'featurette', 'lecture')),
  description text,
  is_primary boolean not null default false,
  is_published boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index trailers_title_idx on trailers (title_id);

create table media_upload_jobs (
  id uuid primary key default gen_random_uuid(),
  video_asset_id uuid not null references video_assets(id) on delete cascade,
  provider text not null,
  status text not null default 'created' check (status in ('created', 'uploading', 'uploaded', 'processing', 'completed', 'failed', 'cancelled')),
  file_name text,
  file_size bigint,
  mime_type text,
  error_message text,
  attempts int not null default 0,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index media_upload_jobs_asset_idx on media_upload_jobs (video_asset_id);

-- ============================================================ REPRODUCCIÓN
create table watch_progress (
  viewer_profile_id uuid not null references viewer_profiles(id) on delete cascade,
  content_type text not null check (content_type in ('episode', 'title')),
  content_id uuid not null,
  title_id uuid not null references titles(id) on delete cascade,
  position_seconds int not null default 0 check (position_seconds >= 0),
  duration_seconds int,
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (viewer_profile_id, content_type, content_id)
);
create index watch_progress_recent_idx on watch_progress (viewer_profile_id, updated_at desc);

create table watch_history (
  id bigserial primary key,
  viewer_profile_id uuid not null references viewer_profiles(id) on delete cascade,
  content_type text not null,
  content_id uuid not null,
  title_id uuid not null references titles(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
create index watch_history_viewer_idx on watch_history (viewer_profile_id, started_at desc);

create table playback_events (
  id bigserial primary key,
  event_type text not null check (event_type in ('page_view', 'play_start', 'play_valid', 'heartbeat', 'pause', 'complete', 'error', 'trailer_start', 'share', 'book_click')),
  content_type text not null check (content_type in ('episode', 'title', 'trailer')),
  content_id uuid not null,
  title_id uuid references titles(id) on delete set null,
  video_asset_id uuid references video_assets(id) on delete set null,
  viewer_profile_id uuid references viewer_profiles(id) on delete set null,
  session_key text,                  -- identificador aleatorio por reproducción (sin datos personales)
  position_seconds int,
  watched_seconds int,
  device text,
  country text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  error_code text,
  created_at timestamptz not null default now()
);
create index playback_events_content_idx on playback_events (content_type, content_id, event_type);
create index playback_events_time_idx on playback_events (created_at);

create table watchlists (
  id uuid primary key default gen_random_uuid(),
  viewer_profile_id uuid not null references viewer_profiles(id) on delete cascade,
  name text not null default 'Mi lista',
  is_default boolean not null default true,
  is_public boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index watchlists_one_default on watchlists (viewer_profile_id) where is_default;

create table watchlist_items (
  watchlist_id uuid not null references watchlists(id) on delete cascade,
  title_id uuid not null references titles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (watchlist_id, title_id)
);

-- ============================================================ PUBLICACIÓN
create table release_schedules (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  episode_id uuid references episodes(id) on delete cascade,
  headline text,
  release_at timestamptz,
  date_label text,                   -- p. ej. «Primavera 2027» cuando no hay fecha confirmada
  is_confirmed boolean not null default false,
  status text not null default 'announced' check (status in ('announced', 'confirmed', 'released', 'postponed', 'cancelled')),
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_confirmed = false or release_at is not null)
);
create index release_schedules_date_idx on release_schedules (release_at);

create table content_availability (
  id uuid primary key default gen_random_uuid(),
  content_type text not null check (content_type in ('title', 'episode')),
  content_id uuid not null,
  allowed_countries text[] not null default '{}',   -- vacío = mundial
  blocked_countries text[] not null default '{}',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (content_type, content_id)
);

create table content_rights (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  rights_type text not null check (rights_type in ('distribution', 'streaming', 'music', 'likeness', 'adaptation', 'other')),
  holder text not null,
  territories text[] not null default '{}',
  starts_at date,
  ends_at date,
  document_url text,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index content_rights_title_idx on content_rights (title_id);

create table featured_content (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references titles(id) on delete cascade,
  episode_id uuid references episodes(id) on delete set null,
  headline text,
  starts_at timestamptz,
  ends_at timestamptz,
  position int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table homepage_sections (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('spotlight', 'continue_watching', 'by_type', 'by_genre', 'by_category', 'collection', 'new_episodes', 'upcoming', 'recent', 'most_viewed', 'recommended', 'behind_scenes', 'manual')),
  heading text not null,
  subheading text,
  config jsonb not null default '{}',
  position int not null default 0,
  is_visible boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table homepage_section_items (
  section_id uuid not null references homepage_sections(id) on delete cascade,
  title_id uuid not null references titles(id) on delete cascade,
  position int not null default 0,
  primary key (section_id, title_id)
);

-- ============================================================ COMERCIAL (Fase 4: estructura preparada, sin flujos activos)
create table products (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('rental', 'purchase', 'membership_monthly', 'membership_annual', 'premiere_pass', 'educational_license', 'institutional_screening', 'book')),
  name text not null,
  title_id uuid references titles(id) on delete set null,
  price_cents int not null check (price_cents >= 0),
  currency text not null default 'USD',
  rental_hours int,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete restrict,
  product_id uuid not null references products(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents int not null,
  currency text not null,
  created_at timestamptz not null default now()
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete restrict,
  provider text not null,
  provider_payment_id text not null,
  status text not null check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  amount_cents int not null,
  currency text not null,
  confirmed_at timestamptz,          -- sólo se rellena con confirmación verificada del proveedor
  raw_event_id uuid,
  created_at timestamptz not null default now(),
  unique (provider, provider_payment_id)
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id) on delete restrict,
  provider text not null,
  provider_subscription_id text not null,
  status text not null check (status in ('trialing', 'active', 'past_due', 'cancelled', 'expired')),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  unique (provider, provider_subscription_id)
);

create table access_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  title_id uuid references titles(id) on delete cascade,  -- null = todo el catálogo premium
  source text not null check (source in ('order', 'subscription', 'grant')),
  source_id uuid,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index access_entitlements_profile_idx on access_entitlements (profile_id);

create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  website_url text,
  description text,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create table sponsorship_placements (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors(id) on delete cascade,
  title_id uuid references titles(id) on delete cascade,
  placement text not null check (placement in ('title_page', 'premiere_campaign', 'homepage', 'presented_by')),
  label text not null default 'Patrocinado',
  starts_at timestamptz,
  ends_at timestamptz,
  is_active boolean not null default false
);

-- ============================================================ COMUNICACIÓN
create table newsletter_subscriptions (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  consent_text text not null,
  consented_at timestamptz not null default now(),
  source text,
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  unsubscribed_at timestamptz
);
create unique index newsletter_email_key on newsletter_subscriptions (lower(email));

create table release_notifications (
  id uuid primary key default gen_random_uuid(),
  release_schedule_id uuid not null references release_schedules(id) on delete cascade,
  email text not null,
  profile_id uuid references profiles(id) on delete set null,
  consent_text text not null,
  consented_at timestamptz not null default now(),
  unsubscribe_token text not null unique default encode(gen_random_bytes(24), 'hex'),
  notified_at timestamptz,
  unsubscribed_at timestamptz
);
create unique index release_notifications_unique on release_notifications (release_schedule_id, lower(email));

create table contact_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('general', 'press', 'licensing', 'sponsorship', 'education')),
  name text not null,
  email text not null,
  organization text,
  message text not null,
  consent_at timestamptz not null default now(),
  status text not null default 'new' check (status in ('new', 'answered', 'archived')),
  created_at timestamptz not null default now()
);

-- ============================================================ ADMINISTRACIÓN
create table admin_audit_logs (
  id bigserial primary key,
  actor_id uuid references profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_time_idx on admin_audit_logs (created_at desc);

create table content_revisions (
  id bigserial primary key,
  entity_type text not null,
  entity_id uuid not null,
  snapshot jsonb not null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index content_revisions_entity_idx on content_revisions (entity_type, entity_id, created_at desc);

create table system_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_id text not null,
  event_type text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_id)
);

-- Triggers updated_at
do $$
declare t text;
begin
  foreach t in array array['profiles', 'titles', 'seasons', 'episodes', 'video_assets', 'media_upload_jobs', 'release_schedules', 'homepage_sections', 'viewer_preferences']
  loop
    execute format('create trigger %I_updated_at before update on %I for each row execute function set_updated_at()', t, t);
  end loop;
end $$;
