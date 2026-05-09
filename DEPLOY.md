# 吉动盲盒 - 部署文档

## 技术架构

- **框架**: Next.js 14 (App Router)
- **数据库**: Turso (libSQL / SQLite 云端，免费) + 本地开发用文件 SQLite
- **部署**: Vercel（免费 Hobby Plan）

---

## 本地开发

```bash
npm install
npm run dev
# 访问 http://localhost:3000
```

首次启动会自动创建数据库并生成管理员账号，**查看终端日志获取初始密码**。
密码为随机生成，仅显示一次，请立即记录并修改。

---

## 部署到 Vercel（免费）

### 第一步：创建 Turso 数据库（免费）

1. 注册 [Turso](https://turso.tech)（GitHub 登录即可）
2. 安装 CLI：`npm install -g @turso/cli`
3. 登录：`turso auth login`
4. 创建数据库：
   ```bash
   turso db create jlai-dating
   ```
5. 获取连接地址：
   ```bash
   turso db show jlai-dating
   # 复制 URL，格式为 libsql://jlai-dating-xxx.turso.io
   ```
6. 创建认证 Token：
   ```bash
   turso db tokens create jlai-dating
   # 复制输出的 Token
   ```

### 第二步：部署到 Vercel（免费）

1. 将代码推送到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "init"
   git remote add origin https://github.com/你的用户名/jlai-dating.git
   git push -u origin main
   ```

2. 登录 [Vercel](https://vercel.com) 并导入 GitHub 仓库

3. 在 Vercel 项目设置 → **Environment Variables** 添加：
   ```
   JWT_SECRET          = 随机32位字符串（必须！）
   ENCRYPT_SECRET      = 随机32位字符串（必须！）
   TURSO_DATABASE_URL  = libsql://jlai-dating-xxx.turso.io
   TURSO_AUTH_TOKEN    = 你的Token
   ```

4. 点击部署，完成！

### 生成随机密钥
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## 管理员账号

首次部署后，管理员账号会自动创建（查看 Vercel 部署日志的 Function Logs）。
**初始密码为随机生成，务必立即登录并修改密码！**

管理后台入口：登录后 → 右上角「管理后台」

---

## 功能说明

| 功能 | 说明 |
|------|------|
| 邀请码注册 | 管理员发10个初始邀请码，每人注册后获得3个邀请码 |
| 心理问卷 | 31题5维度（安全联结、互动模式、意义系统、动力发展、日常系统）|
| 每周匹配 | 管理员后台手动触发，算法基于5维度契合度 + 冲突类型兼容 |
| 匹配结果 | 显示契合度%和原因，双方确认后才展示联系方式 |
| 联系方式加密 | AES-256-GCM 加密存储微信/QQ号 |
| GPS 定位 | 注册时验证是否在校区 1km 范围内 |

---

## 注意事项

- **SQLite 本地文件**不能用于 Vercel（无服务器函数没有持久存储），必须配置 Turso
- Turso 免费版：500MB 存储，1B 行/月，足够校内使用
- 如果学校有自己的服务器，也可以直接 `npm run build && npm start` 部署
- 生产环境必须配置 `JWT_SECRET` 和 `ENCRYPT_SECRET` 环境变量，否则每次重启密钥丢失
