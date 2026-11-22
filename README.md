# CINE LIBROSELLER — Cinema Streaming Experience

> El futuro del cine comienza aquí.

Plataforma de streaming de las películas y series de **Cine LibroSeller Studios**: un portal público para descubrir y ver las obras, y un panel `/admin` para publicarlas sin tocar código.

- Sitio: `https://cine.libroseller.com`
- Administración: `https://cine.libroseller.com/admin`
- Obra inaugural: **Los Convidados al Ágape** (serie): temporada 1, episodio 1 «La petición en la montaña» (15 min). Se crea como **borrador sin materiales**. El equipo carga la sinopsis, el póster, el tráiler y el video oficiales desde el panel. El sistema no inventa ningún archivo.

Esta es la **Fase 1 (Streaming MVP)**. Incluye además las piezas de la Fase 2 que exigen las pruebas obligatorias: cuentas, progreso, «Continúa viendo», Mi lista e historial. No se ha construido software de producción: eso corresponde a CineViral.

---

## Qué incluye

**Portal público**
- **Portada**: billboard cinematográfico con teaser silencioso. El teaser respeta *movimiento reducido*, *ahorro de datos* y conexiones 2G/3G, y nunca activa el sonido. Debajo hay 19 secciones editoriales configurables; las vacías no se muestran. Si no hay nada publicado, aparece una portada de prelanzamiento en vez de un catálogo simulado.
- **Ficha de cada obra**:
  - hero, tráiler en modal, «Ver ahora» o «Continuar T1:E1», Mi lista y Compartir;
  - sinopsis, reparto y equipo, personajes, galería, extras y comparador antes/después;
  - libro original (LibroSeller), próximos estrenos con aviso y obras relacionadas;
  - aviso público del uso de IA.
- **Series**: temporadas, episodios con miniatura y progreso, página propia por episodio, anterior y siguiente.
- **Reproductor (modo cine)**:
  - HLS adaptativo (hls.js; nativo en Safari) y elección de calidad;
  - pistas de audio, subtítulos WebVTT y velocidad;
  - pantalla completa y atajos de teclado (espacio/K, J/L, flechas, M, F, C);
  - reanudación, siguiente episodio con cuenta atrás configurable, miniaturas de navegación (storyboard de Mux);
  - estados de carga y error con «Reintentar», que pide un token nuevo y sigue donde estaba.
- **Búsqueda** por título, sinopsis, género, categoría, director, actor, personaje, episodio, año, país y tipo. Sin coincidencias devuelve **vacío** y sugiere lo que hay; nunca inventa obras.
- **Próximos estrenos**: la cuenta regresiva sólo aparece con **fecha confirmada**. Los avisos se guardan con el texto del consentimiento.
- **Detrás de cámaras**: comparaciones antes/después aprobadas por administración, con la autorización registrada.
- **Cuenta**: registro opcional, preferencias (subtítulos, reproducción automática, ahorro de datos), dispositivos y sesiones, y cierre de las demás sesiones.
- **SEO**:
  - URLs permanentes: `/peliculas/{slug}`, `/series/{slug}`, `/series/{slug}/temporada-1/episodio-1`;
  - canónicas, Open Graph, JSON-LD (`Movie`, `TVSeries`, `TVEpisode`), `sitemap.xml` y `robots.txt` (excluye admin, cuenta y reproductor).

**Panel `/admin`** (roles `editor` y `admin`)
- **Panel**: métricas reales del periodo. Una visita a la ficha no cuenta como reproducción. Incluye reproducciones válidas, minutos, porcentaje completado, dispositivos, fuentes y UTM, lo más visto, estado del streaming, incidencias, próximos estrenos y usuarios.
- **Títulos**: ficha completa con géneros, categorías, IA, libro original y SEO. Estados *Borrador → En revisión → Programado → Publicado → Retirado → Archivado*. La publicación **se bloquea** y lista lo que falta: sinopsis, póster, imagen horizontal, video aprobado y **derechos verificados**.
- **Temporadas y episodios**: un episodio se puede publicar suelto, sin cargar la temporada entera.
- **Video**: subida directa y reanudable a Mux o vínculo a un HLS/MP4 ya alojado en un CDN. Recorre *Pendiente → Cargando → Procesando → En revisión → Listo → Publicado / Error* con:
  - previsualización privada y aprobación;
  - historial de versiones; sustituir el video no pierde ficha ni métricas;
  - «Consultar proveedor» para recuperarse si se pierde un webhook.
- **Imágenes** (con texto alternativo obligatorio) y **subtítulos** (WebVTT o SRT, que se convierte automáticamente).
- **Tráilers y extras**: teaser, clip, entrevista, making of, conferencia.
- **Reparto, personajes** (relaciones, apariciones, aviso de spoilers) y **personas**.
- **Derechos y disponibilidad**: territorios permitidos o bloqueados y ventana de fechas.
- **Portada**: billboard programable; secciones que se pueden ordenar, ocultar, programar y añadir.
- **Estrenos**, **antes/después** (sólo administración aprueba), **usuarios** y **auditoría**.

**API versionada `/api/v1`**
- `playback/{episode|title|trailer}/{id}`: decide el acceso (publicado, ventana, territorio, cuenta, premium) y devuelve la fuente, firmada si procede.
- `progress`, `events`, `watchlist` y `notify`.
- `catalog`: JSON público del catálogo.
- `webhooks/mux` y `webhooks/cineviral`: firma HMAC e idempotencia.
- `cron/publish`, `health` y `admin/uploads`.

## Arquitectura

| Capa | Elección |
|---|---|
| Web | Next.js 16 (App Router, React 19, Server Components y Server Actions), TypeScript, Tailwind CSS 4 |
| Datos | PostgreSQL (**Supabase**), migraciones SQL versionadas en `supabase/migrations/` |
| Video | **Mux** (subida directa, transcodificación, HLS adaptativo, CDN, tokens firmados, webhooks) + proveedor «enlace» para HLS/MP4 en un CDN propio |
| Imágenes y subtítulos | Supabase Storage (producción) o disco local (desarrollo) |
| Despliegue | Vercel; Vercel Cron para estrenos programados |

**¿Por qué Mux?** Combina en un solo servicio la subida directa y reanudable desde el navegador (el archivo maestro nunca pasa por funciones serverless), la transcodificación a HLS adaptativo con CDN global, los webhooks firmados, la reproducción firmada con JWT (sin DRM obligatorio) y el storyboard para las miniaturas. Además tiene SDK de analítica si más adelante se quiere ampliar. Cobra por minuto codificado, almacenado y entregado, lo que con un catálogo pequeño mantiene el coste fijo bajo. La alternativa natural es **Cloudflare Stream**: suele salir más barato con mucha audiencia (cobra minutos entregados y almacenados, sin coste de codificación) y también tiene subidas directas y URLs firmadas. El código aísla el proveedor (`src/lib/video/`), así que añadir un adaptador de Cloudflare no afecta al resto. Ninguno de los dos impide al 100 % la grabación de pantalla. Si un distribuidor exige DRM, hay que activarlo en el proveedor (Mux ofrece DRM como función aparte).

**Autenticación.** Es propia: contraseñas con scrypt, sesiones con token aleatorio guardado sólo como hash, cookies `HttpOnly`/`SameSite=Lax`/`Secure`, bloqueo tras 5 intentos fallidos, límite de peticiones y cierre remoto de sesiones. Se eligió en lugar de Supabase Auth para que todo funcione con una sola conexión a Postgres y se pueda probar en local sin servicios externos. El modelo `profiles` → `viewer_profiles` ya está preparado para varios perfiles por cuenta y controles parentales (`is_kids`, `maturity_limit`). Migrar a Supabase Auth más adelante sólo exige mapear `profiles.id` a `auth.users.id`.

**Seguridad de datos.**
- **RLS** activado y forzado en **todas** las tablas. Supabase publica el esquema `public` por su API REST con la clave anónima; sin política, `anon` y `authenticated` no ven nada. Sólo se abre la **lectura del catálogo publicado**.
- La aplicación accede desde el servidor y autoriza en código: roles, propiedad y origen (CSRF) en cada mutación.
- CSP estricta, HSTS, `X-Robots-Tag: noindex` en admin, auditoría de cada cambio editorial y revisiones (instantáneas) de títulos, temporadas y episodios.
- Analítica minimizada: nunca guarda IP. El país y el vínculo con el perfil sólo se registran con consentimiento.
- No se guardan tarjetas. Las tablas de pagos sólo admiten `confirmed_at` con confirmación del proveedor (Fase 4).

**Modelo de datos.** Las 48 tablas de la sección 28 más `title_categories`, `media_comparisons` y `schema_migrations`. Las de comercio, patrocinios y comunidad existen pero **no tienen flujos activos** todavía (fases 4 y 5).

## Desarrollo local

Requisitos: Node 22+, PostgreSQL 15+ (local o Supabase).

```bash
npm install
```
```bash
cp .env.example .env.local   # ajusta DATABASE_URL; para local: STORAGE_DRIVER=local
```
```bash
npm run db:migrate && npm run db:seed
```
```bash
npm run admin:create -- tu@email.com "Tu nombre"   # imprime una contraseña generada
```
```bash
npm run dev    # http://localhost:3000  ·  panel en /admin
```

Sin claves de Mux, el panel permite **vincular** videos ya alojados en un CDN (HLS `.m3u8` o MP4 por HTTPS con CORS). Con claves de Mux aparece la subida directa.

## Pruebas

```bash
npm test   # 23 pruebas de integración contra PostgreSQL real (usa TEST_DATABASE_URL o cine_test local)
```

Cubren las 20 verificaciones obligatorias de la sección 32 a nivel de servidor:
- crear y publicar;
- subida y webhooks firmados de Mux (simulados), aprobación, reproducción, progreso y reanudación, siguiente episodio;
- subtítulos, tráiler de una obra no publicada, búsqueda sin invenciones, programar y retirar, accesos no autorizados (cuenta, premium, territorio, previsualización, bloqueo por intentos);
- tokens JWT firmados y recuperación ante fallos del proveedor;
- sustitución de video sin perder métricas e ingesta desde CineViral.

```bash
npm run test:e2e   # navegador real: necesita PostgreSQL, ffmpeg y `npm i -D playwright && npx playwright install chromium`
```

La prueba e2e hace lo siguiente:
1. Genera material **de prueba** con ffmpeg: un HLS VP9/Opus con dos calidades, un tráiler, imágenes y subtítulos. Nada de esto entra en el catálogo real.
2. Levanta un CDN local, crea una base de datos limpia y compila la app aparte, en `.next-e2e`.
3. Recorre 26 pasos: el administrador completa, sube, vincula, previsualiza, aprueba y publica; un anónimo ve el tráiler y el episodio, cambia calidad, subtítulos y velocidad, busca y comparte; un usuario registrado guarda el progreso, reanuda y usa Mi lista; se bloquea el acceso indebido, se retira un episodio y se comprueba la vista móvil.

Las capturas quedan en `tests/e2e/artifacts/`.

## Despliegue en producción (Vercel + Supabase + Mux)

Es un proyecto **independiente** de LibroSeller: no toca su aplicación ni su base de datos.

1. **Supabase**: crea un proyecto nuevo (no reutilices la base de LibroSeller).
   - Aplica las migraciones: `DATABASE_URL=<cadena directa, puerto 5432> npm run db:migrate && npm run db:seed`. También funciona con `supabase db push`.
   - Crea el bucket **público** `media`.
   - Crea el primer administrador: `npm run admin:create -- correo "Nombre"`.
2. **Mux**:
   - Crea un *Access Token* (Mux Video lectura/escritura).
   - Crea un *Webhook* hacia `https://cine.libroseller.com/api/v1/webhooks/mux`.
   - Si habrá contenido restringido, crea una *Signing Key*.
3. **Vercel**: importa el repositorio y define las variables de `.env.example`:
   - `DATABASE_URL` con el **pooler** (puerto 6543);
   - `STORAGE_DRIVER=supabase`;
   - `CRON_SECRET` aleatorio.

   El cron de `vercel.json` (cada 15 minutos) necesita el plan Pro; en Hobby pasa a diario. La visibilidad de los estrenos programados no depende del cron: se calcula al consultar.
4. **Dominio**: en Vercel, añade `cine.libroseller.com` y crea en la zona DNS de libroseller.com el **CNAME** `cine → cname.vercel-dns.com`. Comprueba que el proyecto es el correcto antes de asignarlo.
5. **Entornos**: un proyecto de Supabase y unas claves de Mux distintas para *preview* y *production* (las variables por entorno de Vercel lo permiten).
6. **Copias de seguridad**: activa los backups diarios / PITR de Supabase. Mux conserva los assets; guarda también los archivos maestros originales fuera de Mux.
7. **Monitoreo**: `/api/v1/health` (base de datos, proveedor, almacenamiento), el panel de incidencias del admin, los logs de Vercel y el dashboard de Mux.
8. **Reversión**:
   - Vercel permite *Instant Rollback* al despliegue anterior.
   - Las migraciones son aditivas: para revertir una, se escribe otra nueva.
   - Un video sustituido conserva sus versiones anteriores en `video_assets`.

**Al añadir tablas nuevas** en futuras migraciones, activa RLS en ellas (`alter table … enable row level security`).

## Flujo para publicar el primer episodio

1. `/admin/titulos` → **Los Convidados al Ágape** → *Ficha*: sinopsis oficial, eslogan, clasificación, libro original y uso de IA.
2. *Imágenes*: póster vertical y fondo horizontal (y logotipo o banner si existen).
3. *Derechos*: registra el derecho de streaming y márcalo como **verificado**. Publica la serie (la página mostrará «Primer episodio próximamente» hasta que haya episodios).
4. *Temporadas y episodios* → E1 → sube el archivo maestro o vincula el HLS → espera a «En revisión» → **Previsualizar** → **Aprobar** → sube los subtítulos → **Publicar ahora** (o **Programar** con fecha).
5. *Tráilers y extras*: crea el tráiler, sube el video, apruébalo y márcalo como publicado.
6. *Portada*: el bloque «Gran estreno» ya apunta a la serie; ajusta el billboard si quieres un antetítulo.

## Pendiente (fases siguientes)

- **Fase 2**: varios perfiles por cuenta en la interfaz, correo de avisos de estreno (los avisos ya se registran con consentimiento; falta conectar un proveedor de email) y verificación de email.
- **Fase 3**: búsqueda semántica y asistente de personajes. El catálogo y las fichas ya distinguen el canon; el asistente debe basarse sólo en material oficial.
- **Fase 4**: pagos (pasarela, webhooks y entitlements: las tablas ya existen), membresías, alquiler, patrocinios e integración comercial con la API de LibroSeller (hoy el libro se enlaza manualmente desde la ficha).
- **Fase 5**: apps nativas y de TV, descargas offline y DRM.
