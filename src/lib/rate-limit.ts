/**
 * Rate Limiter for Cloudflare Workers / Edge Runtime
 *
 * 支持两种模式：
 * 1. **KV 模式**（生产/有 KV 绑定时）：使用 Cloudflare KV 做分布式限流
 *    - 所有 isolate 共享同一份数据
 *    - 需要在 Cloudflare Dashboard 创建 KV namespace 并绑定到项目
 * 2. **内存 Map 模式**（开发环境/KV 不可用时）：
 *    - 仅在单个 isolate 内有效（与旧版行为一致）
 *    - 用于本地开发和未配置 KV 时 fallback
 *
 * ## 配置步骤（一次性）
 * 1. 登录 Cloudflare Dashboard → Workers & Pages → KV → Create namespace
 *    名称填：`jlai-rate-limit`
 * 2. 进入项目 Settings → Variables → Bindings
 *    添加 KV Binding：
 *      Variable name: RATE_LIMIT_KV
 *      选择刚创建的 namespace: jlai-rate-limit
 * 3. 重新部署即可生效
 *
 * ## 免费额度参考
 * - 读取：100,000 次/天（你们的应用绰绰有余）
 * - 写入：1,000 次/天（够用）
 * - 存储：无限制
 */

interface RateLimitEntry {
  count: number
  resetAt: number
}

export interface RateLimitConfig {
  windowMs: number   // Time window in ms
  max: number        // Max requests per window
}

// Pre-configured limiters
export const LOGIN_LIMITER: RateLimitConfig = { windowMs: 15 * 60 * 1000, max: 10 }
// 注册 IP 限流：校园网共享 IP 场景下需放宽，防滥用靠邮箱维度
export const REGISTER_LIMITER: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 50 }
export const API_LIMITER: RateLimitConfig = { windowMs: 1 * 60 * 1000, max: 60 }
export const SURVEY_LIMITER: RateLimitConfig = { windowMs: 5 * 60 * 1000, max: 10 }

/**
 * 邮箱维度限流（防止同一邮箱频繁操作）
 * 用于注册/发码等场景，作为 IP 限流的补充
 * 校园网多人共享 IP 时，邮箱维度是更精确的防滥用手段
 */
export const EMAIL_REGISTER_LIMITER: RateLimitConfig = { windowMs: 24 * 60 * 60 * 1000, max: 5 }
export const EMAIL_CODE_LIMITER: RateLimitConfig = { windowMs: 60 * 60 * 1000, max: 5 }

// ============================================================
// KV-based rate limiting (production / when KV binding exists)
// ============================================================

function getKV(): any | null {
  // Cloudflare Pages 绑定通过 globalThis 访问
  try {
    const kv = (globalThis as any)?.RATE_LIMIT_KV
    return kv || null
  } catch {
    return null
  }
}

async function checkRateLimitKV(
  ip: string,
  config: RateLimitConfig,
  action: string
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const kv = getKV()
  if (!kv) throw new Error('KV not available')

  const kvKey = `rl:${action}:${ip}`
  const now = Date.now()

  const raw = await kv.get(kvKey)
  let entry: RateLimitEntry

  if (!raw) {
    entry = { count: 1, resetAt: now + config.windowMs }
  } else {
    entry = JSON.parse(raw) as RateLimitEntry
    if (now > entry.resetAt) {
      // Window expired, reset
      entry = { count: 1, resetAt: now + config.windowMs }
    } else {
      entry.count++
    }
  }

  // TTL 设为窗口期（KV 自动过期清理）
  const ttlSeconds = Math.ceil(config.windowMs / 1000) + 10
  await kv.put(kvKey, JSON.stringify(entry), { expirationTtl: ttlSeconds })

  if (entry.count > config.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return { allowed: true, remaining: config.max - entry.count, retryAfter: 0 }
}

// ============================================================
// Memory-based fallback (development / no KV binding)
// ============================================================

// 内存模式最大条目数（防止持续请求导致内存无限增长）
const MAX_MEMORY_ENTRIES = 10000

function getStore(): Map<string, RateLimitEntry> {
  if (!(globalThis as any).__rateLimitStore) {
    (globalThis as any).__rateLimitStore = new Map<string, RateLimitEntry>()
  }
  return (globalThis as any).__rateLimitStore
}

function cleanup() {
  const store = getStore()
  const now = Date.now()

  // 先淘汰过期条目
  for (const key of Array.from(store.keys())) {
    const entry = store.get(key)
    if (entry && now > entry.resetAt) store.delete(key)
  }

  // 超过上限时，按 resetAt 从旧到新清理（最旧的先删）
  if (store.size > MAX_MEMORY_ENTRIES) {
    const sortedKeys = Array.from(store.keys()).sort((a, b) => {
      const aEntry = store.get(a)!
      const bEntry = store.get(b)!
      return (aEntry.resetAt || 0) - (bEntry.resetAt || 0)
    })
    const excess = store.size - MAX_MEMORY_ENTRIES
    for (let i = 0; i < excess; i++) {
      store.delete(sortedKeys[i])
    }
  }
}

function checkRateLimitMemory(
  ip: string,
  config: RateLimitConfig,
  action: string
): { allowed: boolean; remaining: number; retryAfter: number } {
  if (Math.random() < 0.01) cleanup()

  const store = getStore()
  const key = `${action}:${ip}`
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 }
  }

  entry.count++

  if (entry.count > config.max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    }
  }

  return { allowed: true, remaining: config.max - entry.count, retryAfter: 0 }
}

// ============================================================
// Public API — auto-detects KV vs Memory mode
// ============================================================

let _useKV: boolean | null = null

/** Detect once whether KV is available, cache result */
function detectKVAvailable(): boolean {
  if (_useKV !== null) return _useKV
  _useKV = getKV() !== null
  return _useKV
}

export function resetKVCache(): void {
  _useKV = null
}

export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  action: string
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  if (detectKVAvailable()) {
    return checkRateLimitKV(ip, config, action)
  }
  return Promise.resolve(checkRateLimitMemory(ip, config, action))
}

/**
 * 基于邮箱的限流检查（与 IP 维度互补）
 *
 * 适用场景：
 * - 校园网/共享 WiFi 等多人共用同一公网IP的环境
 * - 邮箱是更精确的身份标识，可有效防止单人滥用注册
 */
export async function checkRateLimitByEmail(
  email: string,
  config: RateLimitConfig,
  action: string
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  // 用 email SHA-256 哈希作为 key（避免明文邮箱写入 KV）
  const emailBytes = new TextEncoder().encode(email.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', emailBytes)
  const hashHex = Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
  const emailKey = `eml:${action}:${hashHex}`
  
  if (detectKVAvailable()) {
    // 复用 KV 函数，只是 key 不同
    return checkRateLimitKVWithEmail(emailKey, config)
  }
  return Promise.resolve(checkRateLimitMemoryByEmail(emailKey, config))
}

// ── KV 模式（邮箱维度）──
async function checkRateLimitKVWithEmail(
  kvKey: string,
  config: RateLimitConfig
): Promise<{ allowed: boolean; remaining: number; retryAfter: number }> {
  const kv = getKV()
  if (!kv) throw new Error('KV not available')
  return checkRateLimitKV(kvKey, config, kvKey)
}

// ── Memory 模式（邮箱维度）──
function checkRateLimitMemoryByEmail(
  key: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; retryAfter: number } {
  if (Math.random() < 0.01) cleanup()
  const store = getStore()
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs })
    return { allowed: true, remaining: config.max - 1, retryAfter: 0 }
  }

  entry.count++
  if (entry.count > config.max) {
    return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) }
  }
  return { allowed: true, remaining: config.max - entry.count, retryAfter: 0 }
}
