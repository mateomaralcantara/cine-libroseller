// Variables de entorno tipadas. Los secretos sólo se leen en el servidor.

export class ConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'Error de configuración'; }
}
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : undefined;
}

export const env = {
  get databaseUrl() {
    const v = optional('DATABASE_URL');
    if (!v) throw new ConfigError('Falta DATABASE_URL. Copia .env.example como .env.local y pon la cadena de conexión de tu base de datos.');
    if (/xxxx|\[TU-CONTRASEÑA\]|CONTRASEÑA@/i.test(v)) {
      throw new ConfigError('DATABASE_URL todavía tiene el valor de ejemplo de .env.example. En Supabase ve a Project Settings → Database → Connection string → URI, cópiala en .env.local (con tu contraseña real) y reinicia «npm run dev».');
    }
    return v;
  },
  get siteUrl() {
    return (optional('NEXT_PUBLIC_SITE_URL') || 'http://localhost:3000').replace(/\/$/, '');
  },
  get isProd() {
    return process.env.NODE_ENV === 'production';
  },
  mux: {
    get tokenId() { return optional('MUX_TOKEN_ID'); },
    get tokenSecret() { return optional('MUX_TOKEN_SECRET'); },
    get webhookSecret() { return optional('MUX_WEBHOOK_SECRET'); },
    get signingKeyId() { return optional('MUX_SIGNING_KEY_ID'); },
    get signingPrivateKey() {
      const b64 = optional('MUX_SIGNING_PRIVATE_KEY');
      return b64 ? Buffer.from(b64, 'base64').toString('utf8') : undefined;
    },
    get apiBase() { return optional('MUX_API_BASE') || 'https://api.mux.com'; },
    get configured() { return !!(this.tokenId && this.tokenSecret); },
  },
  storage: {
    get driver(): 'local' | 'supabase' { return optional('STORAGE_DRIVER') === 'supabase' ? 'supabase' : 'local'; },
    get supabaseUrl() { return optional('SUPABASE_URL'); },
    get supabaseServiceKey() { return optional('SUPABASE_SERVICE_ROLE_KEY'); },
    get bucket() { return optional('SUPABASE_STORAGE_BUCKET') || 'media'; },
    get localDir() { return optional('LOCAL_STORAGE_DIR') || 'storage'; },
  },
  get cineviralSecret() { return optional('CINEVIRAL_WEBHOOK_SECRET'); },
};
