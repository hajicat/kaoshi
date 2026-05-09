import { createClient, type Client } from '@libsql/client'

let client: Client | null = null
let dbInitialized = false
let initPromise: Promise<void> | null = null

export function getDb(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL
    const token = process.env.TURSO_AUTH_TOKEN

    if (url && token) {
      client = createClient({ url, authToken: token })
    } else if (url) {
      // Local libsql (for dev without auth)
      client = createClient({ url })
    } else {
      // On Cloudflare Edge runtime, TURSO_DATABASE_URL is required
      // Local SQLite fallback is not available in edge/serverless environments
      throw new Error(
        'TURSO_DATABASE_URL and TURSO_AUTH_TOKEN environment variables are required. ' +
        'See CF-DEPLOY.md for setup instructions.'
      )
    }
  }
  return client
}

export async function initDb(): Promise<void> {
  if (dbInitialized) return
  // 防止并发请求重复执行初始化：复用同一个 Promise
  if (initPromise) { await initPromise; return }
  
  initPromise = doInit()
  try { await initPromise }
  catch (err) { initPromise = null; throw err } // 失败后允许重试
}

async function doInit(): Promise<void> {
  const db = getDb()

  // ── 建表（幂等，IF NOT EXISTS）+ 索引（IF NOT EXISTS）全部批量执行，仅 1 次 DB 往返 ──
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nickname TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      invite_code TEXT UNIQUE NOT NULL,
      invited_by INTEGER REFERENCES users(id),
      is_admin INTEGER DEFAULT 0,
      gender TEXT,
      preferred_gender TEXT,
      school TEXT,
      match_school_prefs TEXT DEFAULT 'all',
      survey_completed INTEGER DEFAULT 0,
      contact_info TEXT,
      contact_type TEXT DEFAULT 'wechat',
      conflict_type TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_match_date TEXT,
      failed_login_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      match_enabled INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS invite_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      used_by INTEGER REFERENCES users(id),
      max_uses INTEGER DEFAULT 1,
      current_uses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS survey_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT,
      q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT,
      q11 TEXT, q12 TEXT, q13 TEXT, q14 TEXT, q15 TEXT,
      q16 TEXT, q17 TEXT, q18 TEXT, q19 TEXT, q20 TEXT,
      q21 TEXT, q22 TEXT, q23 TEXT, q24 TEXT, q25 TEXT,
      q26 TEXT, q27 TEXT, q28 TEXT, q29 TEXT, q30 TEXT,
      q31 TEXT, q32 TEXT, q33 TEXT, q34 TEXT, q35 TEXT,
      q36 TEXT, q37 TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS survey_responses_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      q1 TEXT, q2 TEXT, q3 TEXT, q4 TEXT, q5 TEXT,
      q6 TEXT, q7 TEXT, q8 TEXT, q9 TEXT, q10 TEXT,
      q11 TEXT, q12 TEXT, q13 TEXT, q14 TEXT, q15 TEXT,
      q16 TEXT, q17 TEXT, q18 TEXT, q19 TEXT, q20 TEXT,
      q21 TEXT, q22 TEXT, q23 TEXT, q24 TEXT, q25 TEXT,
      q26 TEXT, q27 TEXT, q28 TEXT, q29 TEXT, q30 TEXT,
      q31 TEXT, q32 TEXT, q33 TEXT, q34 TEXT, q35 TEXT,
      q36 TEXT, q37 TEXT,
      q38 TEXT, q39 TEXT, q40 TEXT, q41 TEXT, q42 TEXT,
      q43 TEXT, q44 TEXT, q45 TEXT, q46 TEXT, q47 TEXT,
      q48 TEXT, q49 TEXT, q50 TEXT, q51 TEXT, q52 TEXT,
      q53 TEXT, q54 TEXT, q55 TEXT, q56 TEXT, q57 TEXT,
      q58 TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id)
    );

    CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a INTEGER NOT NULL REFERENCES users(id),
      user_b INTEGER NOT NULL REFERENCES users(id),
      score REAL NOT NULL,
      dim_scores TEXT,
      reasons TEXT,
      week_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      a_revealed INTEGER DEFAULT 0,
      b_revealed INTEGER DEFAULT 0,
      UNIQUE(user_a, week_key),
      UNIQUE(user_b, week_key)
    );

    CREATE TABLE IF NOT EXISTS matches_v2 (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_a INTEGER NOT NULL REFERENCES users(id),
      user_b INTEGER NOT NULL REFERENCES users(id),
      score REAL NOT NULL,
      dim_scores TEXT,
      reasons TEXT,
      week_key TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      a_revealed INTEGER DEFAULT 0,
      b_revealed INTEGER DEFAULT 0,
      UNIQUE(user_a, week_key),
      UNIQUE(user_b, week_key)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS verification_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS verification_samples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      sampled_at TEXT DEFAULT (datetime('now')),
      session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS gps_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy REAL,
      detected_school TEXT,
      actual_school TEXT,
      user_agent TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

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

    CREATE INDEX IF NOT EXISTS idx_verification_samples_user ON verification_samples(user_id);
    CREATE INDEX IF NOT EXISTS idx_security_logs_created ON security_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_security_logs_ip ON security_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_security_logs_event ON security_logs(event_type);
    CREATE INDEX IF NOT EXISTS idx_survey_v2_user ON survey_responses_v2(user_id);

    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      audience TEXT NOT NULL DEFAULT 'all',
      dismiss_mode TEXT NOT NULL DEFAULT 'once',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS announcement_dismissals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      announcement_id INTEGER NOT NULL REFERENCES announcements(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      dismissed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(announcement_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user ON announcement_dismissals(user_id);
    CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_announcement ON announcement_dismissals(announcement_id);
  `)

  // ── 兼容旧数据库：添加新字段（IF NOT EXISTS 语义用 catch 模拟）──
  // 注意：这些必须在 executeMultiple 外面单独执行，不能混入 SQL 模板字符串
  try { await db.execute({ sql: "ALTER TABLE users ADD COLUMN school TEXT", args: [] }) } catch {}
  try { await db.execute({ sql: "ALTER TABLE users ADD COLUMN match_school_prefs TEXT DEFAULT 'all'", args: [] }) } catch {}

  // ── 种子管理员：直接查事实（is_admin），不依赖间接缓存 ──
  const adminRow = await db.execute('SELECT id FROM users WHERE is_admin = 1')
  if (adminRow.rows.length === 0) {
    // 使用 Web Crypto API（兼容 Edge Runtime）
    const { hashPassword, generateInviteCode } = await import('./security')

    const adminCode = generateInviteCode()
    
    // 管理员邮箱从环境变量读取，避免硬编码泄露
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@jlai.local'
    const adminNickname = process.env.ADMIN_NICKNAME || '管理员'
    
    // 使用 Web Crypto API 生成随机密码
    const pwdBytes = new Uint8Array(12)
    crypto.getRandomValues(pwdBytes)
    const adminPassword = Array.from(pwdBytes, b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    const pwHash = await hashPassword(adminPassword)

    // INSERT OR IGNORE：已存在则跳过（防御性，防止竞态导致 UNIQUE 冲突）
    await db.execute({
      sql: `INSERT OR IGNORE INTO users (nickname, email, password_hash, invite_code, is_admin, gender, preferred_gender)
            VALUES (?, ?, ?, ?, 1, 'other', 'all')`,
      args: [adminNickname, adminEmail, pwHash, adminCode],
    })

    // Get the admin ID
    const adminResult = await db.execute({ sql: 'SELECT id FROM users WHERE email = ?', args: [adminEmail] })
    if (!adminResult.rows.length) {
      console.error('[init] 管理员查询失败，跳过种子操作')
      dbInitialized = true
      return
    }
    const adminId = Number(adminResult.rows[0].id)

    // Generate 10 invite codes for admin (batch insert)
    const adminCodeStmts: Array<{ sql: string; args: any[] }> = []
    for (let i = 0; i < 10; i++) {
      const code = generateInviteCode()
      adminCodeStmts.push({ sql: 'INSERT INTO invite_codes (code, created_by) VALUES (?, ?)', args: [code, adminId] })
    }
    try { await db.batch(adminCodeStmts) } catch (_) {
      // fallback for clients that don't support batch
      for (const stmt of adminCodeStmts) {
        try { await db.execute(stmt) } catch (__) { /* ignore */ }
      }
    }

    // ⚠️ 管理员初始凭据（首次部署时请查看控制台/日志）
    // 仅输出掩码密码（前4位+****），完整密码不输出到任何日志/控制台，
    // 防止 CI/CD 日志、Docker 日志等意外暴露。
    const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production'
    if (isDev) {
      const maskedPassword = adminPassword.slice(0, 4) + '****'
      const maskedCode = adminCode.slice(0, 4) + '****'
      console.log(`\n[INIT] 🔐 管理员账号已创建:`)
      console.log(`  邮箱: ${adminEmail}`)
      console.log(`  密码: ${maskedPassword}`)
      console.log(`  邀请码: ${maskedCode}`)
      console.log(`  ⚠️  请立即登录并修改密码！如需查看完整密码/邀请码，请通过数据库直接查询。\n`)
    } else {
      console.warn(`[INIT] 管理员已创建 (${adminEmail})，生产环境凭据不输出到日志。\n`)
    }
  }

  // ── 智能迁移：先检查列是否存在，只对缺失列执行 ALTER ──
  // 比 try/catch 忽略所有错误更安全，避免不必要的异常捕获
  const alterStatements: { sql: string; table: string; column: string }[] = [
    // users 表新增列
    { sql: `ALTER TABLE users ADD COLUMN gender TEXT`, table: 'users', column: 'gender' },
    { sql: `ALTER TABLE users ADD COLUMN preferred_gender TEXT`, table: 'users', column: 'preferred_gender' },
    { sql: `ALTER TABLE users ADD COLUMN conflict_type TEXT`, table: 'users', column: 'conflict_type' },
    { sql: `ALTER TABLE users ADD COLUMN match_enabled INTEGER DEFAULT 1`, table: 'users', column: 'match_enabled' },
    { sql: `ALTER TABLE users ADD COLUMN password_changed_at TEXT`, table: 'users', column: 'password_changed_at' },
    { sql: `ALTER TABLE users ADD COLUMN email_verified INTEGER DEFAULT 0`, table: 'users', column: 'email_verified' },
    // matches 表新增列
    { sql: `ALTER TABLE matches ADD COLUMN dim_scores TEXT`, table: 'matches', column: 'dim_scores' },
    // 手动匹配来源标记和延迟揭晓时间
    { sql: `ALTER TABLE matches ADD COLUMN source TEXT DEFAULT 'auto'`, table: 'matches', column: 'source' },
    { sql: `ALTER TABLE matches ADD COLUMN reveal_at TEXT`, table: 'matches', column: 'reveal_at' },
    // survey_responses 表新增列
    { sql: `ALTER TABLE survey_responses ADD COLUMN q21 TEXT`, table: 'survey_responses', column: 'q21' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q22 TEXT`, table: 'survey_responses', column: 'q22' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q23 TEXT`, table: 'survey_responses', column: 'q23' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q24 TEXT`, table: 'survey_responses', column: 'q24' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q25 TEXT`, table: 'survey_responses', column: 'q25' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q26 TEXT`, table: 'survey_responses', column: 'q26' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q27 TEXT`, table: 'survey_responses', column: 'q27' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q28 TEXT`, table: 'survey_responses', column: 'q28' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q29 TEXT`, table: 'survey_responses', column: 'q29' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q30 TEXT`, table: 'survey_responses', column: 'q30' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q31 TEXT`, table: 'survey_responses', column: 'q31' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q32 TEXT`, table: 'survey_responses', column: 'q32' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q33 TEXT`, table: 'survey_responses', column: 'q33' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q34 TEXT`, table: 'survey_responses', column: 'q34' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q35 TEXT`, table: 'survey_responses', column: 'q35' },
    // users 表新增学生验证状态字段
    { sql: `ALTER TABLE users ADD COLUMN verification_status TEXT DEFAULT 'pending_verification'`, table: 'users', column: 'verification_status' },
    { sql: `ALTER TABLE users ADD COLUMN verification_score INTEGER DEFAULT 0`, table: 'users', column: 'verification_score' },
    { sql: `ALTER TABLE users ADD COLUMN verified_at TEXT`, table: 'users', column: 'verified_at' },
    // 用户安全等级（管理员可手动设置，否则由问卷自动计算）
    { sql: `ALTER TABLE users ADD COLUMN safety_level TEXT DEFAULT NULL`, table: 'users', column: 'safety_level' },
    // verification_samples 表
    { sql: `ALTER TABLE verification_samples ADD COLUMN session_id TEXT`, table: 'verification_samples', column: 'session_id' },
    // 用户最近在线时间
    { sql: `ALTER TABLE users ADD COLUMN last_active TEXT`, table: 'users', column: 'last_active' },
    // 问卷新增破冰参考题
    { sql: `ALTER TABLE survey_responses ADD COLUMN q36 TEXT`, table: 'survey_responses', column: 'q36' },
    { sql: `ALTER TABLE survey_responses ADD COLUMN q37 TEXT`, table: 'survey_responses', column: 'q37' },
    // V2 问卷完成状态
    { sql: `ALTER TABLE users ADD COLUMN survey_completed_v2 INTEGER DEFAULT 0`, table: 'users', column: 'survey_completed_v2' },
    // matches_v2 手动匹配来源标记和延迟揭晓时间
    { sql: `ALTER TABLE matches_v2 ADD COLUMN source TEXT DEFAULT 'auto'`, table: 'matches_v2', column: 'source' },
    { sql: `ALTER TABLE matches_v2 ADD COLUMN reveal_at TEXT`, table: 'matches_v2', column: 'reveal_at' },
  ]

  // 收集需要 ALTER 的表名，批量查询
  const tablesToCheck = Array.from(new Set(alterStatements.map(a => a.table)))
  for (const tableName of tablesToCheck) {
    const columnsForTable = alterStatements.filter(a => a.table === tableName)
    if (columnsForTable.length === 0) continue

    // 用 PRAGMA table_info 获取当前已有列
    const existingColsResult = await db.execute({ sql: `PRAGMA table_info(${tableName})`, args: [] })
    const existingColumns = new Set<string>()
    for (const row of existingColsResult.rows) {
      existingColumns.add((row as any).name)
    }

    // 只对缺失的列执行 ALTER
    for (const alt of columnsForTable) {
      if (!existingColumns.has(alt.column)) {
        try {
          await db.execute(alt.sql)
        } catch (_) {
          /* 并发或边缘情况时忽略 */
        }
      }
    }
  }

  dbInitialized = true

  // ── V2 问卷数据迁移：修复 q43+ 编号错位 ──
  // ── 种子：算法版本默认 v1 ──
  try {
    await db.execute({
      sql: `INSERT OR IGNORE INTO settings (key, value) VALUES ('algorithm_version', 'v1')`,
      args: [],
    })
  } catch (_) { /* ignore */ }

  // ── 清理过期的 settings 临时数据（每周冷启动自动执行一次）──
  // 包括：问卷周计数（>30天）、匹配锁（>7天）
  try {
    await db.execute({
      sql: `DELETE FROM settings
            WHERE (key LIKE 'survey_week_count_%' AND updated_at < datetime('now', '-30 days'))
               OR (key LIKE 'matching_lock_%' AND updated_at < datetime('now', '-7 days'))
               OR (key LIKE 'matching_lock_v2_%' AND updated_at < datetime('now', '-7 days'))`,
      args: [],
    })
  } catch (_) {
    /* 清理失败不影响主流程 */
  }
}
