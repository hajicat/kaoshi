# 刷题平台 (Quiz Platform)

在线刷题与 PK 对战系统，适合班级内部使用（30-50 人）。

## 技术栈

- **前端**: Next.js 15 App Router + Tailwind CSS
- **后端**: Next.js Route Handlers
- **数据库**: Turso (libSQL) + Drizzle ORM
- **认证**: JWT + HttpOnly Cookie
- **校验**: Zod
- **部署**: Cloudflare Workers + OpenNext（可选）

## 功能

### 用户端
- 📚 题库练习（单选/多选/判断/论述）
- 📊 答题记录与成绩查看
- ⚔️ PK 对战（轮询模式）
- 🔐 登录/退出/修改密码

### 管理后台
- 📊 数据概览仪表盘
- 👥 用户管理（创建/禁用）
- 📚 题库管理（创建/发布/删除）
- 📥 AI 导入（上传文件 → 解析 → 确认入库）
- 📝 答题记录查看
- ✍️ 论述题人工评分
- ⚔️ PK 记录查看

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
TURSO_DATABASE_URL=libsql://your-database.turso.io
TURSO_AUTH_TOKEN=your-auth-token
JWT_SECRET=your-super-secret-jwt-key-at-least-32-chars
```

### 3. 创建 Turso 数据库

```bash
# 安装 Turso CLI
curl -sSfL https://get.tur.so/install.sh | bash

# 登录
turso auth login

# 创建数据库
turso database create quiz-platform

# 获取 URL 和 token
turso database show quiz-platform --url
turso database tokens create quiz-platform
```

### 4. 初始化数据库

```bash
# 生成迁移文件
npx drizzle-kit generate

# 执行迁移
npx drizzle-kit migrate
```

### 5. 初始化管理员和示例数据

```bash
npx tsx scripts/init-admin.ts
```

默认账号：
- **管理员**: admin / admin123
- **测试用户**: student1 / 123456

### 6. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000

## 项目结构

```
quiz-platform/
├── src/
│   ├── app/
│   │   ├── api/              # API 路由
│   │   │   ├── auth/         # 登录/退出/修改密码
│   │   │   ├── admin/        # 管理后台 API
│   │   │   ├── question-banks/ # 题库 API
│   │   │   ├── attempts/     # 答题 API
│   │   │   └── pk/           # PK 对战 API
│   │   ├── admin/            # 管理后台页面
│   │   ├── banks/            # 题库页面
│   │   ├── attempts/         # 答题记录页面
│   │   ├── pk/               # PK 页面
│   │   └── login/            # 登录页
│   ├── lib/
│   │   ├── db/               # 数据库（schema + client）
│   │   ├── auth/             # 认证（JWT + 权限）
│   │   ├── ai/               # AI 解析提示词
│   │   ├── quiz/             # 评分逻辑
│   │   ├── pk/               # PK 服务
│   │   └── validation/       # Zod 校验
│   └── components/           # 组件（预留）
├── scripts/
│   └── init-admin.ts         # 初始化脚本
├── drizzle/
│   └── migrations/           # 数据库迁移
└── package.json
```

## 数据库 Schema

| 表名 | 说明 |
|------|------|
| users | 用户（admin/user） |
| question_banks | 题库 |
| questions | 题目（单选/多选/判断/论述） |
| attempts | 答题记录 |
| attempt_answers | 答题详情 |
| import_jobs | 导入任务 |
| pk_matches | PK 对战 |

## 部署到 Cloudflare Workers（可选）

```bash
# 安装 OpenNext
npm install -g opennext

# 构建
npx opennext build

# 部署
npx wrangler deploy
```

注意：Cloudflare Workers 免费版有 10ms CPU 时间限制，建议使用客户端渲染（已默认采用）。

## 设计决策

1. **客户端渲染优先** — 避免 SSR 在 Workers 免费版 10ms CPU 限制下超时
2. **JWT + HttpOnly Cookie** — 比 localStorage 更安全
3. **PK 用轮询** — 免费版不支持 WebSocket，5 秒轮询够用
4. **AI 解析分块处理** — 避免单次请求处理超大文件
5. **管理员审核入库** — AI 解析结果需人工确认

## License

MIT
