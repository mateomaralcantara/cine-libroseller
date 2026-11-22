// Limitador de ventana fija en memoria. En Vercel cada instancia tiene su propio contador, así que
// es una barrera contra abusos simples; para límites globales conviene Upstash/Redis o el WAF de Vercel.
const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
    return { ok: true, retryAfter: 0 };
  }
  b.count += 1;
  return b.count > max ? { ok: false, retryAfter: Math.ceil((b.reset - now) / 1000) } : { ok: true, retryAfter: 0 };
}

export function resetRateLimits() {
  buckets.clear();
}
