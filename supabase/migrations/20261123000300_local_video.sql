-- Proveedor «local»: videos subidos al disco del propio servidor (pruebas en tu PC, sin Mux ni CDN).
-- No apto para Vercel (sin disco persistente): allí se usa Mux o un enlace a CDN.
alter table video_assets drop constraint if exists video_assets_provider_check;
alter table video_assets add constraint video_assets_provider_check check (provider in ('mux', 'link', 'local'));
