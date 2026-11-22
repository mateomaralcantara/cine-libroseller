// Generador de carteles abstractos en PNG (sin dependencias) para el modo demostración.
// Paisajes cinematográficos: cielo en degradado, astro con halo, cordilleras, grano y viñeta.
import zlib from 'node:zlib';

type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function crc32(buf: Buffer) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export interface ArtOptions {
  width: number;
  height: number;
  palette: [string, string, string, string]; // cielo alto, cielo bajo, astro, montañas
  seed: number;
  sun?: { x: number; y: number; r: number }; // en proporción del ancho/alto
  ridges?: number;
  portrait?: boolean; // silueta de busto (personajes ficticios, sin rasgos reconocibles)
}

export function makeArt(o: ArtOptions): Buffer {
  const { width: W, height: H } = o;
  const [skyTop, skyBottom, sunC, landC] = o.palette.map(hex) as [RGB, RGB, RGB, RGB];
  const rand = rng(o.seed);
  const sun = o.sun ?? { x: 0.3 + rand() * 0.4, y: 0.32 + rand() * 0.12, r: 0.09 + rand() * 0.05 };
  const ridges = o.ridges ?? 3;
  // Perfiles de cordillera: suma de senos con fases aleatorias
  const layers = Array.from({ length: ridges }, (_, i) => {
    const base = 0.55 + (i / Math.max(1, ridges)) * 0.3;
    const waves = Array.from({ length: 4 }, () => ({ f: 1 + rand() * 6, a: 0.015 + rand() * 0.05, p: rand() * Math.PI * 2 }));
    return { base, waves, shade: 0.35 + (i / Math.max(1, ridges)) * 0.6 };
  });
  const raw = Buffer.alloc((W * 3 + 1) * H);
  const minDim = Math.min(W, H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 3 + 1)] = 0;
    const ny = y / H;
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      let c = mix(skyTop, skyBottom, Math.pow(ny, 0.9));
      // astro con halo
      const dx = (x - sun.x * W) / minDim; const dy = (y - sun.y * H) / minDim;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < sun.r) c = mix(c, sunC, 0.92);
      else c = mix(c, sunC, Math.max(0, 0.55 * Math.exp(-(d - sun.r) * 9)));
      // cordilleras (de atrás hacia delante)
      for (const l of layers) {
        let h = l.base;
        for (const w of l.waves) h += Math.sin(nx * w.f * Math.PI * 2 + w.p) * w.a;
        if (ny > h) c = mix(mix(skyBottom, landC, l.shade), [0, 0, 0], (ny - h) * 0.8);
      }
      // busto en silueta para retratos de personajes ficticios
      if (o.portrait) {
        const px = x - W / 2;
        const headR = 0.14 * W;
        const hy = (y - 0.36 * H) / 1.12; // cabeza ligeramente ovalada
        const head = px * px + hy * hy < headR * headR;
        const neck = Math.abs(px) < 0.065 * W && y > 0.4 * H && y < 0.6 * H;
        const sx = px / (0.5 * W); const sy = (y - 1.0 * H) / (0.4 * H);
        const shoulders = Math.pow(Math.abs(sx), 2.6) + Math.pow(Math.abs(sy), 2) < 1; // hombros más rectos
        if (head || neck || shoulders) c = [10, 9, 12];
      }
      // grano y viñeta
      const g = (rand() - 0.5) * 14;
      const vx = nx - 0.5; const vy = ny - 0.5;
      const v = 1 - Math.min(1, (vx * vx + vy * vy) * 1.6);
      const o3 = y * (W * 3 + 1) + 1 + x * 3;
      raw[o3] = clamp(c[0] * v + g); raw[o3 + 1] = clamp(c[1] * v + g); raw[o3 + 2] = clamp(c[2] * v + g);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
