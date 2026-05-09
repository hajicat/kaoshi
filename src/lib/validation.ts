// Input validation utilities

// 要求 TLD 至少 2 个字符，排除 a@b.c 等无效格式
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const NICKNAME_REGEX = /^[\u4e00-\u9fa5a-zA-Z0-9_\-·]{1,20}$/
const INVITE_CODE_REGEX = /^JLAI-[A-F0-9]{16}$/

export interface ValidationResult {
  valid: boolean
  error?: string
}

export function validateEmail(email: string): ValidationResult {
  if (!email || typeof email !== 'string') return { valid: false, error: '邮箱不能为空' }
  if (email.length > 254) return { valid: false, error: '邮箱过长' }
  if (!EMAIL_REGEX.test(email)) return { valid: false, error: '邮箱格式不正确' }
  return { valid: true }
}

export function validatePassword(password: string): ValidationResult {
  if (!password || typeof password !== 'string') return { valid: false, error: '密码不能为空' }
  if (password.length < 8) return { valid: false, error: '密码至少8个字符' }
  if (password.length > 128) return { valid: false, error: '密码过长' }
  // Require at least one letter and one number
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return { valid: false, error: '密码必须包含字母和数字' }
  }
  return { valid: true }
}

export function validateNickname(nickname: string): ValidationResult {
  if (!nickname || typeof nickname !== 'string') return { valid: false, error: '昵称不能为空' }
  const trimmed = nickname.trim()
  if (trimmed.length < 1) return { valid: false, error: '昵称不能为空' }
  if (trimmed.length > 20) return { valid: false, error: '昵称最多20个字符' }
  // Allow Chinese, letters, numbers, common punctuation
  if (!/^[\u4e00-\u9fa5a-zA-Z0-9_\-\·\s]{1,20}$/.test(trimmed)) {
    return { valid: false, error: '昵称包含非法字符' }
  }
  return { valid: true }
}

export function validateInviteCode(code: string): ValidationResult {
  if (!code || typeof code !== 'string') return { valid: false, error: '邀请码不能为空' }
  if (!INVITE_CODE_REGEX.test(code.toUpperCase())) {
    return { valid: false, error: '邀请码格式不正确' }
  }
  return { valid: true }
}

export function sanitizeString(input: string, maxLength: number = 500): string {
  if (typeof input !== 'string') return ''
  // Remove null bytes and control characters (except newline/tab)
  // Note: Do NOT HTML-encode here — that breaks exact-string matching (e.g., whitelist validation).
  // HTML encoding is handled by JSX auto-escape at render time + CSP headers.
  return input
    .replace(/\0/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')
    .slice(0, maxLength)
    .trim()
}

/**
 * Sanitize for storage: strip control chars AND escape HTML entities.
 * Use this for free-text fields (contact info, open-ended answers)
 * before storing in DB. Do NOT use for whitelist-validated fields (q1-q34).
 *
 * Why a separate function? sanitizeString alone doesn't HTML-encode,
 * so XSS payloads like <script> would survive into the database layer.
 * JSX auto-escape protects rendering today, but future features
 * (email templates, PDF export, dangerouslySetInnerHTML) need DB-level safety.
 */
export function sanitizeForStorage(input: string, maxLength: number = 500): string {
  const cleaned = sanitizeString(input, maxLength)
  return cleaned
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
}

// 联系方式白名单：允许微信/QQ/手机号格式字符
// 微信：字母数字下划线连字符（2-20字符）
// QQ：纯数字（5-11位）
// 手机号：纯数字（11位）
// 统一允许：字母、数字、中文、下划线、连字符、空格
const CONTACT_INFO_WHITELIST = /^[a-zA-Z0-9\u4e00-\u9fa5_\- ]+$/

export function validateContactInfo(info: string): ValidationResult {
  if (!info || typeof info !== 'string') return { valid: false, error: '联系方式不能为空' }
  const trimmed = info.trim()
  if (trimmed.length < 2) return { valid: false, error: '联系方式太短' }
  if (trimmed.length > 19) return { valid: false, error: '联系方式过长' }
  // 白名单校验：只允许字母/数字/中文/下划线/连字符/空格
  // 拒绝所有特殊字符（< > " ' / \ ; & 等），从根本上杜绝 XSS 注入
  if (!CONTACT_INFO_WHITELIST.test(trimmed)) {
    return { valid: false, error: '联系方式包含非法字符' }
  }
  return { valid: true }
}

export function validateSurveyAnswer(value: string): ValidationResult {
  if (typeof value !== 'string') return { valid: false, error: '答案格式错误' }
  if (value.length > 200) return { valid: false, error: '答案过长' }
  return { valid: true }
}
