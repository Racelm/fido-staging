/**
 * Rate limiter simple en mémoire (par instance de serveur).
 * Suffisant pour freiner un brute-force basique sur les routes sensibles
 * (par ex. `/invite/[token]`). Pour un déploiement multi-instance, remplacer
 * par un backing store distribué (Redis, Upstash, KV Supabase…).
 */

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

export function rateLimit(key: string, limit: number, windowMs: number): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now()
  const existing = buckets.get(key)
  if (!existing || existing.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, retryAfterMs: 0 }
  }
  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now }
  }
  existing.count += 1
  return { allowed: true, retryAfterMs: 0 }
}

// Nettoyage périodique (léger, évite fuite mémoire)
if (typeof globalThis !== 'undefined' && !(globalThis as { __fido_rl_gc?: boolean }).__fido_rl_gc) {
  ;(globalThis as { __fido_rl_gc?: boolean }).__fido_rl_gc = true
  setInterval(() => {
    const now = Date.now()
    for (const [k, v] of buckets.entries()) {
      if (v.resetAt < now) buckets.delete(k)
    }
  }, 60_000).unref?.()
}
