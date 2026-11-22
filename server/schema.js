// Modelo de dominio de Cine LibroSeller Studios.
// Cada recurso declara sus campos, validaciones y permisos por rol.
// El servidor genera tablas, validación y endpoints CRUD a partir de aquí,
// y el panel /studio construye listas y formularios con la misma definición.

export const ROLES = {
  admin: 'Administración',
  productor: 'Producción',
  vfx: 'VFX / IA',
  ventas: 'Comercial',
  cliente: 'Cliente (portal)',
};

export const CURRENCIES = ['USD', 'DOP', 'EUR', 'MXN', 'COP'];

const STAFF = ['admin', 'productor', 'vfx', 'ventas'];
const PROD = ['admin', 'productor'];
const PROD_VFX = ['admin', 'productor', 'vfx'];
const SALES = ['admin', 'ventas'];
const SALES_PROD = ['admin', 'ventas', 'productor'];

const projectRef = { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects', required: true };

export const RESOURCES = {
  clients: {
    label: 'Clientes', singular: 'Cliente', group: 'Comercial', display: 'name',
    perms: { read: SALES_PROD, write: SALES },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'company', label: 'Empresa', type: 'text', max: 160 },
      { key: 'kind', label: 'Tipo', type: 'enum', options: ['productora', 'marca', 'autor', 'editorial', 'agencia', 'institucion', 'particular'], default: 'particular' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Teléfono', type: 'text', max: 40 },
      { key: 'country', label: 'País', type: 'text', max: 80, default: 'República Dominicana' },
      { key: 'notes', label: 'Notas', type: 'longtext' },
    ],
    list: ['name', 'company', 'kind', 'email', 'country'],
  },

  leads: {
    label: 'Solicitudes', singular: 'Solicitud', group: 'Comercial', display: 'name',
    perms: { read: SALES_PROD, write: SALES },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Teléfono', type: 'text', max: 40 },
      { key: 'company', label: 'Empresa', type: 'text', max: 160 },
      { key: 'country', label: 'País', type: 'text', max: 80 },
      { key: 'service', label: 'Servicio', type: 'enum', options: ['largometraje', 'cortometraje', 'serie', 'comercial', 'videoclip', 'documental', 'trailer_libro', 'vfx_ia', 'produccion_virtual', 'otro'], default: 'otro' },
      { key: 'source_type', label: 'Material de partida', type: 'enum', options: ['idea', 'novela', 'guion', 'material_filmado', 'otro'], default: 'idea' },
      { key: 'budget_range', label: 'Presupuesto', type: 'enum', options: ['<5k', '5k-25k', '25k-100k', '100k-500k', '>500k', 'por_definir'], default: 'por_definir' },
      { key: 'message', label: 'Descripción', type: 'longtext', max: 5000 },
      { key: 'origin', label: 'Origen', type: 'enum', options: ['web', 'cineviral', 'libroseller', 'referido', 'manual'], default: 'manual' },
      { key: 'status', label: 'Estado', type: 'enum', options: ['nuevo', 'contactado', 'propuesta', 'negociacion', 'ganado', 'perdido'], default: 'nuevo' },
      { key: 'assigned_to', label: 'Asignado a', type: 'ref', ref: 'users' },
      { key: 'client_id', label: 'Cliente', type: 'ref', ref: 'clients', readonly: true },
      { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects', readonly: true },
    ],
    list: ['name', 'service', 'source_type', 'budget_range', 'origin', 'status', 'created_at'],
  },

  projects: {
    label: 'Proyectos', singular: 'Proyecto', group: 'Producción', display: 'title',
    perms: { read: [...STAFF, 'cliente'], write: PROD },
    scope: 'client', // el rol cliente sólo ve sus proyectos
    fields: [
      { key: 'code', label: 'Código', type: 'text', max: 24, readonly: true },
      { key: 'title', label: 'Título', type: 'text', required: true, max: 200 },
      { key: 'logline', label: 'Logline', type: 'longtext', max: 1000 },
      { key: 'client_id', label: 'Cliente', type: 'ref', ref: 'clients' },
      { key: 'format', label: 'Formato', type: 'enum', options: ['largometraje', 'cortometraje', 'serie', 'comercial', 'videoclip', 'documental', 'trailer_libro', 'otro'], default: 'cortometraje' },
      { key: 'source_type', label: 'Material de partida', type: 'enum', options: ['idea', 'novela', 'guion', 'material_filmado', 'otro'], default: 'idea' },
      { key: 'source_ref', label: 'Referencia de la fuente', type: 'text', max: 300, help: 'ISBN, título de la novela, versión del guion o enlace' },
      { key: 'production_mode', label: 'Modo de producción', type: 'enum', options: ['tradicional', 'croma', 'virtual', 'hibrido', 'ia_total'], default: 'hibrido' },
      { key: 'stage', label: 'Etapa', type: 'enum', options: ['desarrollo', 'preproduccion', 'rodaje', 'postproduccion', 'vfx', 'revision', 'entregado', 'distribucion', 'cancelado'], default: 'desarrollo' },
      { key: 'start_date', label: 'Inicio', type: 'date' },
      { key: 'delivery_date', label: 'Entrega', type: 'date' },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'price', label: 'Precio pactado', type: 'money' },
      { key: 'producer_id', label: 'Productor responsable', type: 'ref', ref: 'users' },
    ],
    list: ['code', 'title', 'format', 'production_mode', 'stage', 'delivery_date', 'price'],
  },

  talent: {
    label: 'Talento', singular: 'Talento', group: 'Talento y personajes', display: 'name',
    perms: { read: PROD_VFX, write: PROD },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'kind', label: 'Tipo', type: 'enum', options: ['actor_real', 'interprete_digital', 'voz', 'doble'], default: 'actor_real' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Teléfono', type: 'text', max: 40 },
      { key: 'agency', label: 'Agencia', type: 'text', max: 160 },
      { key: 'rate_day', label: 'Tarifa por día', type: 'money' },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'likeness_consent', label: 'Consentimiento de imagen (IA)', type: 'enum', options: ['pendiente', 'otorgado', 'limitado', 'revocado', 'no_aplica'], default: 'pendiente' },
      { key: 'voice_consent', label: 'Consentimiento de voz (IA)', type: 'enum', options: ['pendiente', 'otorgado', 'limitado', 'revocado', 'no_aplica'], default: 'pendiente' },
      { key: 'consent_scope', label: 'Alcance del consentimiento', type: 'longtext', help: 'Proyectos, territorios, usos permitidos y prohibidos' },
      { key: 'consent_expires', label: 'Vence el consentimiento', type: 'date' },
      { key: 'notes', label: 'Notas', type: 'longtext' },
    ],
    list: ['name', 'kind', 'agency', 'rate_day', 'likeness_consent', 'voice_consent', 'consent_expires'],
  },

  characters: {
    label: 'Personajes', singular: 'Personaje', group: 'Talento y personajes', display: 'name',
    perms: { read: PROD_VFX, write: PROD_VFX },
    fields: [
      projectRef,
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'kind', label: 'Naturaleza', type: 'enum', options: ['humano', 'digital', 'hibrido', 'ficticio_ia'], default: 'humano' },
      { key: 'actor_id', label: 'Actor / actriz', type: 'ref', ref: 'talent' },
      { key: 'digital_double_id', label: 'Intérprete o doble digital', type: 'ref', ref: 'talent' },
      { key: 'voice_id', label: 'Voz', type: 'ref', ref: 'talent' },
      { key: 'description', label: 'Descripción', type: 'longtext' },
      { key: 'age_range', label: 'Edad aparente', type: 'text', max: 40 },
      { key: 'status', label: 'Estado', type: 'enum', options: ['casting', 'confirmado', 'en_diseno', 'aprobado'], default: 'casting' },
    ],
    list: ['name', 'project_id', 'kind', 'actor_id', 'digital_double_id', 'status'],
  },

  crew: {
    label: 'Equipo', singular: 'Miembro del equipo', group: 'Equipo y contratos', display: 'name',
    perms: { read: PROD_VFX, write: PROD },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'role', label: 'Cargo', type: 'enum', options: ['direccion', 'produccion', 'fotografia', 'camara', 'sonido', 'arte', 'vestuario', 'maquillaje', 'gaffer', 'edicion', 'color', 'vfx', 'ia', 'musica', 'otro'], default: 'otro' },
      { key: 'email', label: 'Email', type: 'email' },
      { key: 'phone', label: 'Teléfono', type: 'text', max: 40 },
      { key: 'rate_day', label: 'Tarifa por día', type: 'money' },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'availability', label: 'Disponibilidad', type: 'enum', options: ['disponible', 'ocupado', 'vacaciones', 'inactivo'], default: 'disponible' },
      { key: 'notes', label: 'Notas', type: 'longtext' },
    ],
    list: ['name', 'role', 'rate_day', 'availability', 'email'],
  },

  shoots: {
    label: 'Rodajes', singular: 'Jornada de rodaje', group: 'Producción', display: 'location',
    perms: { read: PROD_VFX, write: PROD },
    fields: [
      projectRef,
      { key: 'date', label: 'Fecha', type: 'date', required: true },
      { key: 'call_time', label: 'Citación', type: 'time' },
      { key: 'wrap_time', label: 'Fin previsto', type: 'time' },
      { key: 'type', label: 'Tipo', type: 'enum', options: ['tradicional', 'croma', 'volumen_led', 'exterior', 'estudio'], default: 'tradicional' },
      { key: 'location', label: 'Locación / set', type: 'text', required: true, max: 200 },
      { key: 'scenes', label: 'Escenas', type: 'text', max: 300, help: 'Ej.: 12, 13A, 14' },
      { key: 'tracking', label: 'Captura de tracking / datos de cámara', type: 'bool', default: 0 },
      { key: 'notes', label: 'Notas de producción', type: 'longtext' },
      { key: 'status', label: 'Estado', type: 'enum', options: ['planificado', 'confirmado', 'rodado', 'cancelado'], default: 'planificado' },
    ],
    list: ['date', 'project_id', 'type', 'location', 'scenes', 'status'],
  },

  shots: {
    label: 'Planos VFX / IA', singular: 'Plano VFX', group: 'Postproducción', display: 'code',
    perms: { read: PROD_VFX, write: PROD_VFX },
    fields: [
      projectRef,
      { key: 'code', label: 'Código de plano', type: 'text', required: true, max: 40 },
      { key: 'scene', label: 'Escena', type: 'text', max: 40 },
      { key: 'description', label: 'Descripción', type: 'longtext' },
      { key: 'technique', label: 'Técnica', type: 'enum', options: ['composicion', 'set_extension', 'rotoscopia', 'limpieza', 'cg', 'ia_generativa', 'reemplazo_rostro', 'rejuvenecimiento', 'voz_ia', 'relighting', 'otro'], default: 'composicion' },
      { key: 'character_id', label: 'Personaje afectado', type: 'ref', ref: 'characters', help: 'Obligatorio para reemplazo de rostro, rejuvenecimiento o voz IA' },
      { key: 'shoot_id', label: 'Material de rodaje', type: 'ref', ref: 'shoots' },
      { key: 'assignee_id', label: 'Artista', type: 'ref', ref: 'crew' },
      { key: 'tool', label: 'Herramienta', type: 'text', max: 120, help: 'Nuke, Blender, ComfyUI, Runway, etc.' },
      { key: 'iterations', label: 'Iteraciones', type: 'int', default: 0 },
      { key: 'due_date', label: 'Fecha límite', type: 'date' },
      { key: 'cost_estimate', label: 'Costo estimado (moneda del proyecto)', type: 'money' },
      { key: 'status', label: 'Estado', type: 'enum', options: ['pendiente', 'en_proceso', 'revision', 'aprobado', 'rechazado', 'bloqueado'], default: 'pendiente' },
    ],
    list: ['code', 'project_id', 'technique', 'assignee_id', 'iterations', 'due_date', 'status'],
  },

  continuity: {
    label: 'Biblia de continuidad', singular: 'Ficha de continuidad', group: 'Postproducción', display: 'subject',
    perms: { read: PROD_VFX, write: PROD_VFX },
    fields: [
      projectRef,
      { key: 'category', label: 'Categoría', type: 'enum', options: ['personaje', 'escenario', 'voz', 'vestuario', 'maquillaje', 'utileria', 'iluminacion'], default: 'personaje' },
      { key: 'subject', label: 'Elemento', type: 'text', required: true, max: 200 },
      { key: 'character_id', label: 'Personaje', type: 'ref', ref: 'characters' },
      { key: 'scenes', label: 'Escenas', type: 'text', max: 300 },
      { key: 'reference_url', label: 'Referencia visual / audio', type: 'url' },
      { key: 'spec', label: 'Especificación técnica', type: 'longtext', help: 'Paleta, medidas, prompt base, semilla, modelo/LoRA, perfil de voz, LUT…' },
      { key: 'locked', label: 'Bloqueada (aprobada)', type: 'bool', default: 0 },
      { key: 'notes', label: 'Notas', type: 'longtext' },
    ],
    list: ['subject', 'project_id', 'category', 'character_id', 'scenes', 'locked'],
  },

  contracts: {
    label: 'Contratos', singular: 'Contrato', group: 'Equipo y contratos', display: 'title',
    perms: { read: SALES_PROD, write: PROD },
    fields: [
      { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects' },
      { key: 'title', label: 'Título', type: 'text', required: true, max: 200 },
      { key: 'party_type', label: 'Contraparte', type: 'enum', options: ['talento', 'equipo', 'cliente', 'proveedor', 'licencia', 'autor'], default: 'talento' },
      { key: 'party_name', label: 'Nombre de la contraparte', type: 'text', required: true, max: 200 },
      { key: 'talent_id', label: 'Talento', type: 'ref', ref: 'talent' },
      { key: 'crew_id', label: 'Miembro del equipo', type: 'ref', ref: 'crew' },
      { key: 'client_id', label: 'Cliente', type: 'ref', ref: 'clients' },
      { key: 'amount', label: 'Monto', type: 'money' },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'start_date', label: 'Inicio', type: 'date' },
      { key: 'end_date', label: 'Fin', type: 'date' },
      { key: 'ai_clause', label: 'Incluye cláusula de uso de IA / réplica digital', type: 'bool', default: 0 },
      { key: 'status', label: 'Estado', type: 'enum', options: ['borrador', 'enviado', 'firmado', 'vencido', 'rescindido'], default: 'borrador' },
      { key: 'file_url', label: 'Documento', type: 'url' },
    ],
    list: ['title', 'project_id', 'party_type', 'party_name', 'amount', 'ai_clause', 'status', 'end_date'],
  },

  events: {
    label: 'Agenda', singular: 'Evento', group: 'Producción', display: 'title',
    perms: { read: STAFF, write: [...PROD, 'ventas', 'vfx'] },
    fields: [
      { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects' },
      { key: 'title', label: 'Título', type: 'text', required: true, max: 200 },
      { key: 'kind', label: 'Tipo', type: 'enum', options: ['reunion', 'casting', 'scouting', 'prueba', 'revision', 'entrega', 'estreno', 'otro'], default: 'reunion' },
      { key: 'start', label: 'Inicio', type: 'datetime', required: true },
      { key: 'end', label: 'Fin', type: 'datetime' },
      { key: 'location', label: 'Lugar', type: 'text', max: 200 },
      { key: 'notes', label: 'Notas', type: 'longtext' },
    ],
    list: ['start', 'title', 'kind', 'project_id', 'location'],
  },

  budget_items: {
    label: 'Presupuesto', singular: 'Partida', group: 'Finanzas', display: 'description',
    perms: { read: SALES_PROD, write: PROD },
    fields: [
      projectRef,
      { key: 'category', label: 'Categoría', type: 'enum', options: ['desarrollo', 'guion', 'talento', 'equipo', 'locaciones', 'equipamiento', 'vfx_ia', 'computo_ia', 'postproduccion', 'musica', 'marketing', 'legal', 'otros'], default: 'otros' },
      { key: 'description', label: 'Concepto', type: 'text', required: true, max: 200 },
      { key: 'vendor', label: 'Proveedor', type: 'text', max: 160 },
      { key: 'planned', label: 'Presupuestado', type: 'money', default: 0 },
      { key: 'actual', label: 'Gastado', type: 'money', default: 0 },
      { key: 'paid', label: 'Pagado', type: 'bool', default: 0 },
    ],
    list: ['description', 'project_id', 'category', 'vendor', 'planned', 'actual', 'paid'],
  },

  versions: {
    label: 'Versiones', singular: 'Versión', group: 'Postproducción', display: 'label',
    perms: { read: [...STAFF, 'cliente'], write: PROD_VFX },
    scope: 'project',
    fields: [
      projectRef,
      { key: 'label', label: 'Etiqueta', type: 'text', required: true, max: 60, help: 'Ej.: v3 offline, Trailer v2' },
      { key: 'kind', label: 'Tipo', type: 'enum', options: ['animatic', 'previs', 'offline', 'online', 'vfx_pass', 'color', 'mezcla', 'master', 'trailer'], default: 'offline' },
      { key: 'url', label: 'Enlace al archivo', type: 'url', required: true },
      { key: 'notes', label: 'Notas de entrega', type: 'longtext' },
      { key: 'client_visible', label: 'Visible para el cliente', type: 'bool', default: 0 },
      { key: 'status', label: 'Estado', type: 'enum', options: ['en_revision', 'cambios_solicitados', 'aprobado'], default: 'en_revision', readonly: true },
    ],
    list: ['label', 'project_id', 'kind', 'client_visible', 'status', 'created_at'],
  },

  offerings: {
    label: 'Catálogo', singular: 'Oferta', group: 'Comercial', display: 'name',
    perms: { read: STAFF, write: SALES },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'category', label: 'Categoría', type: 'enum', options: ['servicio', 'paquete', 'licencia'], default: 'servicio' },
      { key: 'description', label: 'Descripción', type: 'longtext' },
      { key: 'price_from', label: 'Precio desde', type: 'money' },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'unit', label: 'Unidad', type: 'text', max: 60, help: 'por proyecto, por minuto, por territorio…' },
      { key: 'public', label: 'Publicado en la web', type: 'bool', default: 1 },
    ],
    list: ['name', 'category', 'price_from', 'currency', 'unit', 'public'],
  },

  deals: {
    label: 'Ventas y licencias', singular: 'Negocio', group: 'Comercial', display: 'title',
    perms: { read: SALES_PROD, write: SALES },
    fields: [
      { key: 'title', label: 'Título', type: 'text', required: true, max: 200 },
      { key: 'kind', label: 'Tipo', type: 'enum', options: ['produccion', 'servicio', 'licencia', 'distribucion', 'patrocinio'], default: 'produccion' },
      { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects' },
      { key: 'client_id', label: 'Cliente', type: 'ref', ref: 'clients' },
      { key: 'offering_id', label: 'Oferta del catálogo', type: 'ref', ref: 'offerings' },
      { key: 'territory', label: 'Territorio', type: 'text', max: 120 },
      { key: 'channel', label: 'Canal', type: 'enum', options: ['directo', 'web', 'cineviral', 'libroseller', 'festival', 'plataforma', 'agente'], default: 'directo' },
      { key: 'amount', label: 'Monto', type: 'money', default: 0 },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'stage', label: 'Etapa', type: 'enum', options: ['prospecto', 'propuesta', 'negociacion', 'ganado', 'perdido'], default: 'prospecto' },
      { key: 'close_date', label: 'Fecha de cierre', type: 'date' },
    ],
    list: ['title', 'kind', 'client_id', 'channel', 'amount', 'stage', 'close_date'],
  },

  payments: {
    label: 'Movimientos', singular: 'Movimiento', group: 'Finanzas', display: 'reference',
    perms: { read: SALES_PROD, write: ['admin', 'productor', 'ventas'] },
    fields: [
      { key: 'project_id', label: 'Proyecto', type: 'ref', ref: 'projects' },
      { key: 'deal_id', label: 'Negocio', type: 'ref', ref: 'deals' },
      { key: 'direction', label: 'Tipo', type: 'enum', options: ['ingreso', 'egreso'], default: 'ingreso' },
      { key: 'amount', label: 'Monto', type: 'money', required: true },
      { key: 'currency', label: 'Moneda', type: 'enum', options: CURRENCIES, default: 'USD' },
      { key: 'date', label: 'Fecha', type: 'date', required: true },
      { key: 'method', label: 'Método', type: 'enum', options: ['transferencia', 'tarjeta', 'efectivo', 'cheque', 'paypal', 'otro'], default: 'transferencia' },
      { key: 'reference', label: 'Referencia', type: 'text', max: 160 },
    ],
    list: ['date', 'direction', 'project_id', 'deal_id', 'amount', 'currency', 'reference'],
  },

  users: {
    label: 'Usuarios', singular: 'Usuario', group: 'Sistema', display: 'name',
    perms: { read: STAFF, write: ['admin'] },
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', required: true, max: 160 },
      { key: 'email', label: 'Email', type: 'email', required: true, unique: true },
      { key: 'role', label: 'Rol', type: 'enum', options: Object.keys(ROLES), default: 'productor' },
      { key: 'client_id', label: 'Cliente (sólo portal)', type: 'ref', ref: 'clients' },
      { key: 'active', label: 'Activo', type: 'bool', default: 1 },
      { key: 'password', label: 'Contraseña', type: 'password', virtual: true, help: 'Mínimo 10 caracteres. Déjala vacía para no cambiarla.' },
    ],
    list: ['name', 'email', 'role', 'active'],
  },
};

// Campos que nunca salen del servidor
export const PRIVATE_COLUMNS = { users: ['password_hash'] };

export function publicMeta() {
  return { roles: ROLES, currencies: CURRENCIES, resources: RESOURCES };
}
