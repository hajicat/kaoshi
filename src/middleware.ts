import { NextRequest, NextResponse } from 'next/server'
import { getCookieName } from '@/lib/csrf'

// Max request body size: 1MB (prevent DoS / large payload attacks)
const MAX_BODY_SIZE = 1024 * 1024

export function middleware(request: NextRequest) {
  // ---- Request Body Size Limit ----
  const contentLength = request.headers.get('content-length')
  if (contentLength && Number(contentLength) > MAX_BODY_SIZE) {
    return new NextResponse(
      JSON.stringify({ error: '请求体过大' }),
      {
        status: 413,
        headers: { 'content-type': 'application/json' },
      }
    )
  }

  // ---- Security Headers ----
  const response = NextResponse.next()

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY')

  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff')

  // XSS Protection (legacy browsers)
  response.headers.set('X-XSS-Protection', '1; mode=block')

  // Referrer Policy
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  // Permissions Policy - restrict browser features
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)')

  // Content Security Policy - hardened for production
  // NOTE: script-src/style-src 的 unsafe-inline 是 Next.js hydration + 内联样式所需。
  //       未来可考虑迁移到 nonce-based CSP（需要 next.config 配置 + 中间件注入）。
  //       当前已通过以下多层防护降低风险：
  //         1. 输入白名单校验（联系方式白名单、问卷选项严格匹配）
  //         2. sanitizeForStorage（HTML 实体转义）
  //         3. React JSX 自动转义
  //         4. AES-256-GCM 加密存储敏感数据
  const isDev = process.env.NODE_ENV !== 'production'
  response.headers.set(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://static.cloudflareinsights.com`,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // Restrict object/embed/plugin sources to prevent Flash/PDF-based attacks
      "object-src 'none'",
      // Block mixed content in production
      ...(process.env.NODE_ENV === 'production' ? ["upgrade-insecure-requests"] : []),
    ].join('; ')
  )

  // HSTS - force HTTPS in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    )
  }

  // Remove server identification
  response.headers.delete('X-Powered-By')

  // Explicit CORS policy - only allow same-origin requests (ignore null/invalid origins)
  const origin = request.headers.get('origin')
  if (origin && origin !== 'null' && origin === new URL(request.url).origin) {
    // CORS header 必须回显浏览器发送的实际 origin，不能用字面量 'self'
    response.headers.set('Access-Control-Allow-Origin', origin)
    response.headers.set('Vary', 'Origin')
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-csrf-token')
    response.headers.set('Access-Control-Max-Age', '86400')
  }

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: response.headers })
  }

  // Set CSRF token cookie if not present (using Web Crypto API for Edge compatibility)
  const csrfCookieName = getCookieName('csrf-token')
  if (!request.cookies.get(csrfCookieName)?.value) {
    // Generate random bytes using Web Crypto API (available in Edge Runtime)
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const csrfToken = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    // ⚠️ 有意设计：httpOnly: false
    // Double Submit Cookie 模式要求前端 JS 能读取 cookie 值并设置到 x-csrf-token header，
    // 因此必须允许 JS 访问此 cookie。风险已通过 CSP script-src 限制缓解。
    response.cookies.set(csrfCookieName, csrfToken, {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
