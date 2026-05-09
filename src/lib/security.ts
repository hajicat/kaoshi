// Edge Runtime compatible security module
// Uses Web Crypto API instead of Node.js crypto module

import type { NextRequest } from 'next/server'

// --- Secrets Management ---
let _cachedJwtSecret: string | undefined
let _cachedEncryptKey: string | undefined

function getJwtSecret(): string {
  if (_cachedJwtSecret) return _cachedJwtSecret
  if (typeof process !== 'undefined' && process.env?.JWT_SECRET) {
    _cachedJwtSecret = process.env.JWT_SECRET
  }
  if (!_cachedJwtSecret) {
    // 开发环境允许随机生成，生产环境必须设置环境变量
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
    if (!isDev) {
      throw new Error(
        'CRITICAL: JWT_SECRET 环境变量未设置！' +
        '请在 Cloudflare Pages 设置中添加 JWT_SECRET（至少64位随机字符串）。' +
        '未设置此变量会导致每次部署后所有用户被强制登出。'
      )
    }
    const bytes = new Uint8Array(64)
    crypto.getRandomValues(bytes)
    _cachedJwtSecret = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
    console.warn('[SECURITY] ⚠️ JWT_SECRET 未设置，使用临时随机值（仅开发模式）')
  }
  return _cachedJwtSecret
}

function getEncryptKey(): string {
  if (_cachedEncryptKey) return _cachedEncryptKey
  
  // Cloudflare Pages 环境变量通过 process.env 访问
  const envSecret = typeof process !== 'undefined' ? process.env?.ENCRYPT_SECRET : undefined
  
  if (envSecret) {
    _cachedEncryptKey = envSecret
    return _cachedEncryptKey
  }
  
  // 检测是否为生产环境（Cloudflare Pages 或明确设置 NODE_ENV=production）
  const isCloudflarePages = typeof process !== 'undefined' && !!process.env?.CF_PAGES
  const isProduction = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production'
  
  if (isCloudflarePages || isProduction) {
    throw new Error(
      'CRITICAL: ENCRYPT_SECRET 环境变量未设置！' +
      '请在 Cloudflare Pages 设置 → 环境变量中添加 ENCRYPT_SECRET（64位十六进制字符串）。' +
      '未设置此变量将导致所有联系方式无法加密/解密！'
    )
  }
  
  // 仅本地开发环境使用随机密钥
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  _cachedEncryptKey = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
  console.warn('[SECURITY] ⚠️ ENCRYPT_SECRET 未设置，使用临时随机值（仅开发模式）')
  return _cachedEncryptKey
}

// --- Utility helpers ---
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const buffer = new ArrayBuffer(hex.length / 2)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function strToBytes(str: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(str) as Uint8Array<ArrayBuffer>
}

function bytesToStr(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

// Constant-time string comparison
function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// ============================================================
// PASSWORD HASHING - PBKDF2 (Web Crypto API)
// ============================================================

// CF Edge Runtime CPU 限制：100k 次迭代约 500ms 会超时（Free 计划 ~50ms 上限）
// 降低到 5000 次，兼顾安全性与 CF 兼容性（~20-30ms）
// 同时与登录接口的 SHA-256 dummy hash 耗时接近（~10-50ms），避免 timing attack
const PBKDF2_ITERATIONS = 5000
const KEY_LENGTH = 64 // 512 bits

/**
 * 获取 pepper 密钥（服务端静态密钥，用于在密码哈希前混入额外熵）
 * 从环境变量 PEPPER_SECRET 读取，不存在则使用 JWT_SECRET 的哈希派生
 * 目的：即使数据库被拖库 + 盐泄露，攻击者仍无法离线暴力破解（缺少 pepper）
 */
// 缓存 pepper（模块级，只算一次）
let _cachedPepper: string | undefined
let _pepperPromise: Promise<string> | undefined

/**
 * 获取 pepper 密钥（服务端静态密钥，用于在密码哈希前混入额外熵）
 * 从环境变量 PEPPER_SECRET 读取，不存在则用 JWT_SECRET 的 SHA-256 派生
 * 目的：即使数据库被拖库 + 盐泄露，攻击者仍无法离线暴力破解（缺少 pepper）
 *
 * 安全说明：
 * - 有 PEPPER_SECRET → 直接使用（最优）
 * - 无 PEPPER_SECRET → 用 SHA-256(JWT_SECRET) 派生 256 位 pepper（次优但安全）
 * - 生产环境应始终设置 PEPPER_SECRET 环境变量
 */
async function getPepper(): Promise<string> {
  const envPepper = typeof process !== 'undefined' ? process.env?.PEPPER_SECRET : undefined
  if (envPepper) return envPepper

  // 已缓存则直接返回
  if (_cachedPepper) return _cachedPepper

  // 已有计算中的 Promise，复用（防止并发重复计算）
  if (_pepperPromise) return _pepperPromise

  // 用 JWT_SECRET 的 SHA-256 哈希作为 pepper（256 位输出）
  // 注意：这仅是 fallback，生产环境应始终设置 PEPPER_SECRET 环境变量
  _pepperPromise = (async () => {
    try {
      const jwtSecret = getJwtSecret()
      const data = new TextEncoder().encode(`jlai-pepper:${jwtSecret}`)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hex = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
      _cachedPepper = `pepper_${hex}`
      return _cachedPepper!
    } catch {
      return '_default_pepper_fallback_'
    } finally {
      _pepperPromise = undefined
    }
  })()

  return _pepperPromise
}

export async function hashPassword(password: string): Promise<string> {
  const saltBytes = new Uint8Array(32)
  crypto.getRandomValues(saltBytes)
  const saltHex = bytesToHex(saltBytes)

  // 将 pepper 混入密码再哈希，防止数据库泄露后离线暴力破解
  const pepper = await getPepper()
  const pepperedPassword = `${pepper}:${password}`

  const keyMaterial = await crypto.subtle.importKey(
    'raw', strToBytes(pepperedPassword), { name: 'PBKDF2' }, false, ['deriveBits']
  )

  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITERATIONS, hash: 'SHA-512' },
    keyMaterial,
    KEY_LENGTH * 8
  )

  const hashHex = bytesToHex(new Uint8Array(derivedBits))
  return `pbkdf2$${saltHex}$${hashHex}$${PBKDF2_ITERATIONS}-sha512`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split('$')

    if (parts[0] === 'pbkdf2' && parts.length === 4) {
      const [, saltHex, expectedHash, paramStr] = parts
      const [iterationsStr] = paramStr.split('-')
      const iterations = parseInt(iterationsStr, 10)
      const saltBytes = hexToBytes(saltHex)

      // --- 尝试带 pepper 验证（新哈希） ---
      const pepper = await getPepper()
      let keyMaterial = await crypto.subtle.importKey(
        'raw', strToBytes(`${pepper}:${password}`), { name: 'PBKDF2' }, false, ['deriveBits']
      )
      let derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' },
        keyMaterial,
        KEY_LENGTH * 8
      )
      let hashHex = bytesToHex(new Uint8Array(derivedBits))
      if (timingSafeEqualStr(hashHex, expectedHash)) return true

      // --- Fallback：无 pepper 验证（旧哈希，pepper 上线前注册的用户） ---
      keyMaterial = await crypto.subtle.importKey(
        'raw', strToBytes(password), { name: 'PBKDF2' }, false, ['deriveBits']
      )
      derivedBits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-512' },
        keyMaterial,
        KEY_LENGTH * 8
      )
      hashHex = bytesToHex(new Uint8Array(derivedBits))
      return timingSafeEqualStr(hashHex, expectedHash)
    }

    if (parts[0] === 'scrypt') {
      console.warn('[SECURITY] Legacy scrypt hash detected. User needs password reset.')
      return false
    }

    return false
  } catch {
    return false
  }
}

// ============================================================
// JWT TOKEN (HMAC-SHA256 via Web Crypto)
// ============================================================

function base64url(bytes: Uint8Array): string {
  let str = ''
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i])
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlEncode(str: string): string {
  return base64url(strToBytes(str))
}

function base64urlDecode(str: string): string {
  str = str.replace(/-/g, '+').replace(/_/g, '/')
  while (str.length % 4) str += '='
  const bytes = Uint8Array.from(atob(str), c => c.charCodeAt(0))
  return bytesToStr(bytes)
}

async function hmacSha256(key: string, data: string): Promise<string> {
  const keyObj = await crypto.subtle.importKey(
    'raw', strToBytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', keyObj, strToBytes(data))
  return base64url(new Uint8Array(signature))
}

export async function createToken(payload: { id: number; email: string; isAdmin: boolean }): Promise<string> {
  const jwtSecret = getJwtSecret()
  const header = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const now = Math.floor(Date.now() / 1000)
  // 生成随机 JWT ID 用于未来 token 吊销/追踪
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const jti = bytesToHex(bytes)
  const body = base64urlEncode(JSON.stringify({
    ...payload,
    iss: 'jlai-dating',
    aud: 'jlai-dating',
    jti,
    iat: now,
    exp: now + 7 * 24 * 60 * 60,
  }))

  const signature = await hmacSha256(jwtSecret, `${header}.${body}`)
  return `${header}.${body}.${signature}`
}

/**
 * 基础 token 验证（仅校验签名、过期、iss/aud）
 * 用于公开接口（如 home-data）
 */
export async function verifyToken(token: string): Promise<{ id: number; email: string; isAdmin: boolean } | null> {
  try {
    const jwtSecret = getJwtSecret()
    const parts = token.split('.')
    if (parts.length !== 3) return null

    const [header, body, signature] = parts
    
    // 验证 JWT header 的 alg 字段必须是 HS256，防止算法混淆攻击
    try {
      const headerObj = JSON.parse(base64urlDecode(header))
      if (headerObj.alg !== 'HS256') return null
    } catch { return null }
    
    const expectedSig = await hmacSha256(jwtSecret, `${header}.${body}`)

    if (!timingSafeEqualStr(signature, expectedSig)) return null

    const payload = JSON.parse(base64urlDecode(body))

    if (payload.iss !== 'jlai-dating' || payload.aud !== 'jlai-dating') return null
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null

    return { id: payload.id, email: payload.email, isAdmin: payload.isAdmin }
  } catch {
    return null
  }
}

/**
 * 安全 token 验证（用于敏感操作接口）
 * 额外校验：token 签发时间(iat)必须晚于用户密码修改时间
 * 即：用户改密码后，所有旧 token 立即失效
 */
export async function verifyTokenSafe(
  token: string,
  dbClient?: { execute(sql: { sql: string; args: (number | string)[] }): Promise<{ rows: any[] }> }
): Promise<{ id: number; email: string; isAdmin: boolean } | null> {
  const result = await verifyToken(token)
  if (!result) return null

  // 无数据库客户端时回退到基础验证（如 home-data 接口）
  if (!dbClient) return result

  try {
    const userResult = await dbClient.execute({
      sql: 'SELECT password_changed_at FROM users WHERE id = ?',
      args: [result.id],
    })
    const row = userResult.rows[0] as any
    const changedAt = row?.password_changed_at
    if (!changedAt) {
      // 从未改过密码，放行 + 更新最近在线
      dbClient.execute({
        sql: `UPDATE users SET last_active = datetime('now') WHERE id = ?`,
        args: [result.id],
      }).catch(() => {})
      return result
    }

    // 解析 JWT payload 拿 iat
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(base64urlDecode(parts[1]))
    const iat = payload.iat as number

    // password_changed_at 是 ISO 时间字符串，转为 Unix 秒
    const changedTs = Math.floor(new Date(changedAt).getTime() / 1000)

    // 如果 token 在修改之前签发的 → 失效
    if (iat < changedTs) {
      return null
    }

    // fire-and-forget：更新最近在线时间，不阻塞请求
    dbClient.execute({
      sql: `UPDATE users SET last_active = datetime('now') WHERE id = ?`,
      args: [result.id],
    }).catch(() => {})

    return result
  } catch {
    // 出错时安全起见拒绝
    return null
  }
}

export function generateInviteCode(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return 'JLAI-' + bytesToHex(bytes).toUpperCase()
}

// ============================================================
// AES-256-GCM ENCRYPTION (Web Crypto API)
// ============================================================

const IV_LEN = 12

async function deriveKey(raw: string): Promise<CryptoKey> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', strToBytes(raw))
  return crypto.subtle.importKey(
    'raw', hashBuffer, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']
  )
}

export async function encrypt(plaintext: string): Promise<string> {
  const key = await deriveKey(getEncryptKey())
  const iv = new Uint8Array(IV_LEN)
  crypto.getRandomValues(iv)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    strToBytes(plaintext)
  )

  const encBytes = new Uint8Array(encrypted)
  const ciphertext = encBytes.slice(0, encBytes.length - 16)
  const tag = encBytes.slice(encBytes.length - 16)

  return `${bytesToHex(iv)}:${bytesToHex(tag)}:${bytesToHex(ciphertext)}`
}

export async function decrypt(data: string): Promise<string> {
  try {
    const parts = data.split(':')
    if (parts.length !== 3) return ''

    const [ivHex, tagHex, encHex] = parts
    const key = await deriveKey(getEncryptKey())
    const iv = hexToBytes(ivHex)
    const tag = hexToBytes(tagHex)
    const encrypted = hexToBytes(encHex)

    const combined = new Uint8Array(encrypted.length + tag.length)
    combined.set(encrypted)
    combined.set(tag, encrypted.length)

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      combined
    )

    return bytesToStr(new Uint8Array(decrypted))
  } catch (err) {
    // 静默返回空串（保持向后兼容），但记录警告以便排查 ENCRYPT_SECRET 配置变更
    console.warn('[security] decrypt failed:', err instanceof Error ? err.message : String(err))
    return ''
  }
}

// ============================================================
// SILENT SECURITY EVENT LOGGING (入侵静默采集)
// ============================================================

export type SecurityEventType =
  | 'login_fail'        // 登录密码错误
  | 'login_locked'      // 账号被锁定
  | 'rate_limited'      // 触发限流
  | 'csrf_fail'         // CSRF 校验失败
  | 'admin_auth_fail'   // 管理员二级密码错误
  | 'register_suspicious' // 注册可疑行为
  | 'xss_attempt'       // XSS 注入尝试
  | 'sql_injection_attempt' // SQL 注入尝试
  | 'path_traversal'    // 路径穿越尝试
  | 'command_injection' // 命令注入尝试

export type SecuritySeverity = 'info' | 'warning' | 'critical'

export interface SecurityEventInput {
  eventType: SecurityEventType
  severity: SecuritySeverity
  email?: string
  userId?: number
  detail?: Record<string, unknown>
}

/**
 * 静默安全事件采集
 *
 * 【核心原则】攻击者完全感知不到被监控：
 * 1. 不 await — 调用方不等待写入完成，响应时间零影响
 * 2. 不抛错 — 任何内部错误都被吞掉，不影响主流程
 * 3. 不改变响应 — 调用方的 status/message/header 一律不变
 *
 * @param req - NextRequest 对象，用于提取 IP/UA/CF地理信息
 * @param input - 事件类型、严重程度、可选的关联信息
 */
export function logSecurityEvent(
  req: Request | NextRequest,
  input: SecurityEventInput
): Promise<void> {
  // 返回 Promise，内部完全静默：任何错误都不冒泡
  return (async () => {
    try {
      const { getDb, initDb } = await import('./db')

      // 提取 IP（优先 CF connectingIp）
      let ip = 'unknown'
      try {
        const cf = (req as any)?.cf as { connectingIp?: string } | undefined
        if (cf?.connectingIp) {
          ip = cf.connectingIp
        } else {
          const forwarded = req.headers.get('x-forwarded-for')
          if (forwarded) {
            const firstIp = forwarded.split(',')[0]?.trim()
            if (firstIp) ip = firstIp
          }
        }
      } catch { /* ignore */ }

      // 提取 CF 地理信息（Cloudflare 自动注入，攻击者无法感知）
      let cfCountry: string | null = null
      let cfRegion: string | null = null
      let cfCity: string | null = null
      try {
        const cf = (req as any)?.cf as Record<string, any> | undefined
        if (cf) {
          cfCountry = typeof cf.country === 'string' ? cf.country : null
          cfRegion = typeof cf.region === 'string' ? cf.region : null
          cfCity = typeof cf.city === 'string' ? cf.city : null
        }
      } catch { /* ignore */ }

      const userAgent = req.headers.get('user-agent') || null
      const path = new URL(req.url).pathname
      const method = req.method

      // detail 截断防滥用（攻击者可能构造超长 payload）
      let detailStr: string | null = null
      if (input.detail) {
        try {
          detailStr = JSON.stringify(input.detail)
          if (detailStr.length > 2000) detailStr = detailStr.slice(0, 2000)
        } catch { detailStr = null }
      }

      // email 截断
      const email = input.email ? input.email.slice(0, 254) : null

      const db = getDb()
      await initDb()

      try {
        await db.execute({
          sql: `INSERT INTO security_logs
                (event_type, severity, ip, user_agent, path, method, email, user_id, detail, cf_country, cf_region, cf_city)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            input.eventType,
            input.severity,
            ip,
            userAgent,
            path,
            method,
            email,
            input.userId ?? null,
            detailStr,
            cfCountry,
            cfRegion,
            cfCity,
          ],
        })
      } catch (insertErr) {
        // 表可能不存在（initDb 的 executeMultiple 可能没执行到），尝试单独建表再重试
        const errMsg = insertErr instanceof Error ? insertErr.message : String(insertErr)
        if (errMsg.includes('no such table') || errMsg.includes('does not exist')) {
          await db.executeMultiple(`
            CREATE TABLE IF NOT EXISTS security_logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              event_type TEXT NOT NULL,
              severity TEXT NOT NULL DEFAULT 'info',
              ip TEXT,
              user_agent TEXT,
              path TEXT,
              method TEXT,
              email TEXT,
              user_id INTEGER,
              detail TEXT,
              cf_country TEXT,
              cf_region TEXT,
              cf_city TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);
            CREATE INDEX IF NOT EXISTS idx_security_logs_event ON security_logs(event_type);
          `)
          // 重试插入
          await db.execute({
            sql: `INSERT INTO security_logs
                  (event_type, severity, ip, user_agent, path, method, email, user_id, detail, cf_country, cf_region, cf_city)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              input.eventType,
              input.severity,
              ip,
              userAgent,
              path,
              method,
              email,
              input.userId ?? null,
              detailStr,
              cfCountry,
              cfRegion,
              cfCity,
            ],
          })
        } else {
          throw insertErr
        }
      }
    } catch (err) {
      // 日志写入失败不能影响任何正常流程，但开发时需要知道原因
      console.error('[logSecurityEvent] silent failure:', err instanceof Error ? err.message : String(err))
    }
  })()
}

// ============================================================
// ATTACK PATTERN DETECTION (静默攻击模式检测)
// ============================================================

/**
 * 攻击特征匹配规则
 * 每条规则：{ pattern: 正则, eventType: 事件类型, description: 描述 }
 *
 * 设计原则：
 * - 只检测常见攻击特征，不拦截，不改响应
 * - 大小写不敏感（攻击者常用大小写混淆绕过）
 * - 匹配到就静默记录到安全日志
 */
const ATTACK_PATTERNS: readonly { pattern: RegExp; eventType: SecurityEventType; description: string }[] = [
  // --- XSS ---
  { pattern: /<\s*script[\s>]/i, eventType: 'xss_attempt', description: '<script> tag' },
  { pattern: /on\w+\s*=\s*['"]/i, eventType: 'xss_attempt', description: 'event handler (on...=)' },
  { pattern: /javascript\s*:/i, eventType: 'xss_attempt', description: 'javascript: protocol' },
  { pattern: /<\s*img[^>]+on\w+\s*=/i, eventType: 'xss_attempt', description: '<img> with event handler' },
  { pattern: /<\s*svg[^>]+on\w+\s*=/i, eventType: 'xss_attempt', description: '<svg> with event handler' },
  { pattern: /<\s*iframe/i, eventType: 'xss_attempt', description: '<iframe> tag' },
  { pattern: /document\.(cookie|location|write)/i, eventType: 'xss_attempt', description: 'DOM access (document.cookie/location/write)' },
  { pattern: /eval\s*\(/i, eventType: 'xss_attempt', description: 'eval() call' },

  // --- SQL Injection ---
  { pattern: /('\s*(or|and)\s+['\d])/i, eventType: 'sql_injection_attempt', description: "SQL logic injection (' OR/AND ...)" },
  { pattern: /union\s+(all\s+)?select/i, eventType: 'sql_injection_attempt', description: 'UNION SELECT' },
  { pattern: /;\s*(drop|alter|truncate|delete|update|insert)\s+/i, eventType: 'sql_injection_attempt', description: 'SQL DDL/DML after semicolon' },
  { pattern: /'\s*--\s*$/i, eventType: 'sql_injection_attempt', description: "SQL comment after quote (' --)" },
  { pattern: /'\s*;\s*$/i, eventType: 'sql_injection_attempt', description: "SQL statement terminator after quote (' ;)" },
  { pattern: /\b(execute|exec)\s*\(\s*@/i, eventType: 'sql_injection_attempt', description: 'SQL stored procedure exec' },
  { pattern: /information_schema/i, eventType: 'sql_injection_attempt', description: 'information_schema access' },

  // --- Path Traversal ---
  { pattern: /\.\.[\\\/]/, eventType: 'path_traversal', description: 'Path traversal (../)' },
  { pattern: /[\\\/]\.\.[\\\/]/, eventType: 'path_traversal', description: 'Path traversal (/../)' },
  { pattern: /\.\.%2[fF]/, eventType: 'path_traversal', description: 'URL-encoded path traversal (..%2F)' },
  { pattern: /%2[eE]%2[eE][\\\/%]/, eventType: 'path_traversal', description: 'Double URL-encoded path traversal' },

  // --- Command Injection ---
  { pattern: /[;&|`]\s*(rm|cat|ls|wget|curl|bash|sh|python|perl|nc|ncat|netcat)\s/i, eventType: 'command_injection', description: 'Shell command after separator' },
  { pattern: /\$\(\s*(rm|cat|ls|wget|curl|bash|sh)\s/i, eventType: 'command_injection', description: 'Command substitution $(...)' },
  { pattern: /\b(system|popen|exec)\s*\(/i, eventType: 'command_injection', description: 'System call function' },
]

/**
 * 静默攻击模式检测
 *
 * 递归扫描请求体中的所有字符串值，匹配攻击特征。
 * 匹配到就静默记录，不改变任何响应或阻断逻辑。
 *
 * @param req - NextRequest 对象（用于提取攻击者信息）
 * @param body - 请求体对象（任意结构，递归扫描所有字符串值）
 */
export async function detectAttackPatterns(
  req: Request | NextRequest,
  body: Record<string, unknown>
): Promise<void> {
  // 完全静默，任何异常都不冒泡
  try {
    const findings: Partial<Record<SecurityEventType, string[]>> = {}

    // 递归提取所有字符串值
    const extractStrings = (obj: unknown, depth: number): string[] => {
      if (depth > 5) return [] // 防止超深嵌套
      if (typeof obj === 'string') return [obj]
      if (Array.isArray(obj)) {
        return obj.flatMap(item => extractStrings(item, depth + 1))
      }
      if (obj && typeof obj === 'object') {
        return Object.values(obj as Record<string, unknown>).flatMap(v => extractStrings(v, depth + 1))
      }
      return []
    }

    const allStrings = extractStrings(body, 0)
    // 只检测前 20 个字符串字段（性能保护，避免攻击者构造超大 body）
    const stringsToCheck = allStrings.slice(0, 20)

    for (const str of stringsToCheck) {
      // 跳过过短字符串（不可能包含攻击 payload）
      if (str.length < 4) continue
      for (const rule of ATTACK_PATTERNS) {
        if (rule.pattern.test(str)) {
          if (!findings[rule.eventType]) {
            findings[rule.eventType] = []
          }
          findings[rule.eventType]!.push(rule.description)
        }
      }
    }

    // 每种事件类型只记一条日志，合并所有匹配规则描述
    for (const [eventType, matches] of Object.entries(findings)) {
      await logSecurityEvent(req, {
        eventType: eventType as SecurityEventType,
        severity: 'critical',
        detail: {
          matchedPatterns: Array.from(new Set(matches)), // 去重
          sampledInput: stringsToCheck[0]?.slice(0, 100) || '', // 最多100字符的输入样本
        },
      })
    }
  } catch (err) {
    // 检测失败不能影响任何正常流程，但开发时需要知道原因
    console.error('[detectAttackPatterns] silent failure:', err instanceof Error ? err.message : String(err))
  }
}
