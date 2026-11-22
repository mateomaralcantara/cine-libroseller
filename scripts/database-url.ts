// Lee DATABASE_URL y explica en español qué hacer si falta o sigue siendo el ejemplo.
export function databaseUrl(): string {
  const v = (process.env.DATABASE_URL || '').trim();
  if (!v) {
    console.error('✗ Falta DATABASE_URL.\n  Copia .env.example como .env.local y pon la cadena de conexión de tu base de datos.');
    process.exit(1);
  }
  if (/xxxx|\[TU-CONTRASEÑA\]|CONTRASEÑA@/i.test(v)) {
    console.error('✗ DATABASE_URL todavía tiene el valor de ejemplo de .env.example.\n  En Supabase: Project Settings → Database → Connection string → URI.\n  Pégala en .env.local con tu contraseña real y vuelve a ejecutar el comando.');
    process.exit(1);
  }
  return v;
}
