# Cine LibroSeller Studios — Hybrid Film Production OS

> Historias humanas. Cine sin límites.

Plataforma operativa de una productora cinematográfica híbrida: capta clientes, convierte ideas, novelas y guiones en proyectos, gestiona actores reales y personajes IA, coordina rodajes (locación, croma, volumen LED), controla planos VFX/IA y continuidad, administra contratos, agenda y presupuesto, revisa versiones con el cliente hasta su aprobación, mide la rentabilidad y se conecta con **LibroSeller** y **CineViral**.

- Sitio público: `https://cine.libroseller.com`
- Panel privado: `https://cine.libroseller.com/studio`

## Arranque rápido

Requisitos: Node.js ≥ 22.13 (usa el SQLite incorporado `node:sqlite`; no hay dependencias nativas).

```bash
npm install
```

```bash
ADMIN_PASSWORD='CambiaEsto2026' npm run seed   # crea el admin y carga datos de demostración
```

```bash
npm start   # http://localhost:3000 y http://localhost:3000/studio
```

```bash
npm test    # 14 pruebas de API: seguridad, permisos, reglas de negocio, integraciones
```

Sin `ADMIN_PASSWORD`, el primer arranque genera una contraseña aleatoria y la imprime **una sola vez** en consola.
Los usuarios de demostración (`prod@`, `vfx@`, `ventas@`, `cliente@demo.cine.libroseller.com`) usan la contraseña `Demo2026cine` (configurable con `DEMO_PASSWORD`). No cargues la demo en producción.

## Qué hace (mapa a la misión)

| # | Objetivo | Dónde |
|---|----------|-------|
| 1 | Captar y atender clientes | Formulario público con honeypot y límite de tasa → **Solicitudes** (embudo, asignación, origen web / CineViral / LibroSeller) |
| 2 | Idea, novela o guion → proyecto | **Convertir en proyecto**: crea cliente (reutiliza por email), proyecto con código `CLS-AAAA-NNNN` y negocio en propuesta |
| 3 | Actores reales, intérpretes digitales, personajes | **Talento** (consentimiento de imagen y voz con alcance y vencimiento) y **Personajes** (humano / digital / híbrido / ficticio IA; actor, doble digital y voz) |
| 4 | Rodaje tradicional y croma / producción virtual | **Rodajes** por jornada (tipo, citación, escenas, captura de tracking) + detección de días con varios proyectos |
| 5 | Transformar material con IA y VFX | **Planos VFX / IA**: técnica, artista, herramienta, iteraciones (suben solas al pasar a revisión), costo, vencimiento |
| 6 | Continuidad de personajes, escenarios, voces, vestuario | **Biblia de continuidad** (prompt base, semilla, LoRA, perfil de voz, paleta…) con fichas bloqueables + **informe de continuidad y derechos** por proyecto |
| 7 | Equipos, contratos, calendario, presupuesto | **Equipo**, **Contratos** (cláusula de réplica digital), **Calendario unificado** (rodajes, eventos, entregas, vencimientos), **Presupuesto** previsto vs. ejecutado |
| 8 | Versiones y revisiones hasta aprobación | **Sala de revisión**: reproductor, notas con timecode, resolver notas, aprobar / pedir cambios; el cliente participa desde su portal |
| 9 | Comercializar producciones, servicios y licencias | **Catálogo** (publicado en la web), **Ventas y licencias** por canal y territorio |
| 10 | Costos, rentabilidad, rendimiento comercial | **Rentabilidad**: margen real y proyectado por proyecto en su moneda, consolidado en USD, flujo de caja mensual, ventas por canal |
| 11 | Conectar CineViral y LibroSeller | **Integraciones**: webhooks entrantes firmados y publicación saliente de versiones aprobadas (ver abajo) |

### Regla ética incorporada

Un plano que altera o sintetiza a una persona real (reemplazo de rostro, rejuvenecimiento, IA generativa sobre un personaje con intérprete, voz IA) **no puede marcarse como aprobado** si esa persona no tiene consentimiento vigente (`otorgado` o `limitado`, no vencido). El servidor lo rechaza con `409`, el tablero lo muestra como riesgo y el informe de continuidad lo lista como hallazgo de severidad alta.

## Roles

| Rol | Acceso |
|-----|--------|
| `admin` | Todo, incluidos usuarios, integraciones, tasas de cambio y auditoría |
| `productor` | Proyectos, talento, rodajes, contratos, presupuesto, revisiones; lectura comercial |
| `vfx` | Planos, personajes, continuidad, versiones; lectura de producción |
| `ventas` | Solicitudes, clientes, catálogo, negocios, movimientos; lectura de proyectos |
| `cliente` | Portal: sólo sus proyectos y las versiones marcadas como visibles; comenta y aprueba |

Los permisos se declaran por recurso en `server/schema.js` y se aplican en el servidor; el panel sólo oculta lo que el servidor ya prohíbe.

## Integraciones LibroSeller / CineViral

> El prompt maestro llegó cortado en el punto 11 («Conectar CineViral y LibroSeller mediante…»). Implementé un contrato de webhooks firmados, que es lo más neutral; si el texto original pedía otra cosa (SSO compartido, API de catálogo, pagos), se adapta aquí.

**Entrante** — `POST /api/hooks/{libroseller|cineviral}`

- Cabecera `X-Signature: sha256=<HMAC-SHA256 del cuerpo con el secreto>`; `X-Event-Id` para idempotencia.
- El secreto se genera en *Integraciones* y se muestra una sola vez.

| Proveedor | Evento | Efecto |
|-----------|--------|--------|
| libroseller | `book.adaptation_request` | Solicitud de adaptación (novela → largo, corto o serie) |
| libroseller | `book.trailer_order` | Solicitud de booktrailer |
| cineviral | `lead.captured` | Solicitud captada en una campaña (suma al contador de la publicación) |
| cineviral | `metrics.update` | Actualiza vistas, likes, compartidos y clics de una publicación |

```json
{ "type": "book.trailer_order",
  "data": { "book": { "title": "Los faros apagados", "author": "M. J. Liriano", "isbn": "978-…", "synopsis": "…" },
            "contact": { "name": "María José Liriano", "email": "mj@example.com" }, "package": "Booktrailer 60 s" } }
```

**Saliente** — desde la sala de revisión, una versión **aprobada** se publica con `trailer.publish` (LibroSeller) o `video.publish` (CineViral), firmada igual. Si la integración no está configurada queda **en cola** y se reintenta desde *Integraciones*.

## Arquitectura

```
server/
  schema.js        modelo de dominio: campos, validaciones, permisos (fuente única)
  db.js            SQLite (WAL, claves foráneas), migraciones aditivas, auditoría
  auth.js          scrypt, sesiones con token hasheado, bloqueo tras 5 intentos, límites de tasa
  validate.js      validación y normalización por tipo de campo
  rules.js         reglas de negocio: consentimiento, códigos de proyecto, iteraciones, divisas
  routes/crud.js   CRUD genérico con filtros, búsqueda, orden, alcance por cliente
  routes/workflows.js  conversión, revisión, continuidad, finanzas, tablero, calendario
  routes/integrations.js  webhooks y publicaciones
  routes/public.js catálogo, vitrina y formulario de contacto
public/
  index.html + assets/   sitio público
  studio/                panel (SPA en módulos ES, sin compilación)
test/api.test.js
```

**Seguridad:** contraseñas con scrypt; cookie de sesión `HttpOnly; SameSite=Lax` (`Secure` en producción) con el token guardado sólo como hash; bloqueo temporal por intentos fallidos; verificación de `Origin` y `Content-Type: application/json` en peticiones que modifican datos; CSP estricta sin scripts ni estilos en línea; consultas siempre parametrizadas con nombres de columna tomados del esquema; HMAC con comparación en tiempo constante; registro de auditoría de altas, cambios, borrados, inicios de sesión y decisiones.

## Despliegue

```bash
docker build -t cine-libroseller .
```

```bash
docker run -d -p 3000:3000 -v cine-data:/data -e TRUST_PROXY=1 -e ADMIN_PASSWORD='…' cine-libroseller
```

Pon delante un proxy con TLS (Caddy, Nginx o Cloudflare) para `cine.libroseller.com` y respalda el volumen `/data` (un solo archivo SQLite; `sqlite3 cine.db ".backup copia.db"` en caliente). Variables en `.env.example`.

## Límites conocidos y siguientes pasos

- **Archivos de vídeo:** las versiones se enlazan por URL (Frame.io, Drive, S3…); no hay subida ni transcodificación propia.
- **Una instancia:** SQLite y el limitador de tasa en memoria sirven para un servidor. Para escalar horizontalmente: PostgreSQL y Redis.
- **Correo:** no se envían notificaciones (nueva solicitud, versión lista para revisión); falta un proveedor SMTP.
- **Pagos en línea y facturación fiscal (NCF en RD):** fuera del alcance de esta versión.
- **Generación IA:** el sistema gestiona y controla el trabajo con herramientas externas (ComfyUI, Runway, Nuke…); no las ejecuta.
