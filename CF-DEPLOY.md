# 吉动盲盒 - Cloudflare Pages 部署指南

## 前置条件

- Cloudflare 账号（免费即可）：https://dash.cloudflare.com/sign-up
- Turso 数据库（免费）：https://turso.tech
- GitHub 账号（代码需要从 Gitee 迁移到 GitHub，因为 CF Pages 只支持 GitHub/GitLab）

---

## 第一步：创建 Turso 数据库

1. 注册 [Turso](https://turso.tech)（用 GitHub 登录）
2. 安装 CLI：
   ```bash
   npm install -g @turso/cli
   ```
3. 登录：
   ```bash
   turso auth login
   ```
4. 创建数据库：
   ```bash
   turso db create jlai-dating
   ```
5. 获取连接地址：
   ```bash
   turso db show jlai-dating
   # 复制 URL，格式如：libsql://jlai-dating-xxx.turso.io
   ```
6. 创建 Token：
   ```bash
   turso db tokens create jlai-dating
   # 复制输出的 Token
   ```

---

## 第二步：代码推送到 GitHub

Gitee 不能直接连 Cloudflare Pages，需要推到 GitHub：

```bash
# 在项目目录下
cd jlai-dating

# 添加 GitHub remote
git remote add github https://github.com/你的用户名/jlai-dating.git
git push github main
```

---

## 第三步：在 Cloudflare Pages 部署

### 方式一：通过 Dashboard（推荐新手）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**
3. 选择你的 GitHub 仓库 `jlai-dating`
4. 配置构建设置：
   - **Framework preset**: Next.js
   - **Build command**: `npx @cloudflare/next-on-pages`
   - **Build output directory**: `.vercel/output/static`
   - **Node.js version**: 18 或 20
5. 点击 **Save and Deploy**

### 方式二：通过 Wrangler CLI（推荐进阶）

```bash
# 安装 wrangler
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 在项目目录下构建并部署
npm run deploy
```

---

## 第四步：配置环境变量

在 Cloudflare Pages 项目 → **Settings** → **Environment variables** 中添加：

| 变量名 | 值 | 说明 |
|--------|-----|------|
| `JWT_SECRET` | 随机64位字符串 | JWT 签名密钥，**必须设置** |
| `ENCRYPT_SECRET` | 随机32位字符串 | 加密密钥，**必须设置** |
| `TURSO_DATABASE_URL` | `libsql://jlai-dating-xxx.turso.io` | Turso 连接地址 |
| `TURSO_AUTH_TOKEN` | 你的 Token | Turso 认证 Token |
| `NODE_ENV` | `production` | 生产环境标记 |

### 生成随机密钥

```bash
node -e "console.log('JWT:', require('crypto').randomBytes(64).toString('hex')); console.log('ENC:', require('crypto').randomBytes(32).toString('hex'))"
```

> ⚠️ **重要**：JWT_SECRET 和 ENCRYPT_SECRET 必须设置！不设置的话每次重启会随机生成，导致所有用户登录态和加密数据失效。

---

## 第五步：获取管理员凭据

首次部署后，查看 Cloudflare Pages 的 **Functions** 日志：

1. 进入项目 → **Functions** → **Logs** (Live)
2. 找到类似 `管理员初始凭据` 的日志
3. 记录邮箱、密码、邀请码
4. **立即登录并修改密码！**

管理员入口：登录后 → 右上角「管理后台」

---

## 自定义域名（可选）

1. Cloudflare Pages 项目 → **Custom domains**
2. 添加你的域名（如 `dating.yourdomain.com`）
3. 如果域名在 Cloudflare 托管，自动配置 DNS
4. 如果不在，按提示添加 CNAME 记录

---

## 更新部署

推送到 GitHub 就会自动部署：

```bash
git add .
git commit -m "update"
git push github main
# Cloudflare Pages 自动触发构建
```

---

## 已知限制

1. **密码哈希已从 scrypt 改为 PBKDF2** — 旧版本地开发的用户密码需要重新注册
2. **速率限制** 是内存级别的，CF Worker 重启后重置（校园小应用够用）
3. **首次加载可能稍慢** — CF Worker 冷启动约 50-200ms
4. 免费计划：每天 100,000 次请求，足够校内使用

---

## 故障排查

| 问题 | 解决方案 |
|------|---------|
| 构建失败 | 检查 Node.js 版本，确保用 18+ |
| 500 错误 | 检查环境变量是否都设置了 |
| 数据库连接失败 | 检查 TURSO_DATABASE_URL 和 TURSO_AUTH_TOKEN |
| 登录失效 | JWT_SECRET 变了会导致所有 token 失效，确保不变 |
