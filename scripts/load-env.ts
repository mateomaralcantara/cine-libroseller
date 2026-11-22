// Carga .env.local (y .env) para los scripts de la línea de comandos, como hace Next.js con la app.
// Tolera el BOM que añade el Bloc de notas de Windows, los finales de línea CRLF y los valores entre comillas.
// Las variables ya definidas en el sistema tienen prioridad.
import fs from 'node:fs';
import path from 'node:path';

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let value = m[2];
    const quoted = value.match(/^(['"])([\s\S]*)\1$/);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '').trim(); // comentario al final de la línea
    if (!(m[1] in out)) out[m[1]] = value;
  }
  return out;
}

for (const name of ['.env.local', '.env']) {
  const file = path.resolve(name);
  if (!fs.existsSync(file)) continue;
  for (const [k, v] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v;
  }
}
