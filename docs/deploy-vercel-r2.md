# LiveBoard 从零部署到 Vercel Hobby、Neon、Upstash 与 Cloudflare R2

本文用于把 LiveBoard 的一个**全新实例**部署到云端，覆盖 GitHub、Neon
PostgreSQL、Upstash Redis、Cloudflare R2、Vercel API/Web、首次管理员初始化、
域名、发布同步、验收和排错。

部署全新实例**不要求先迁移旧数据**。如果要保留旧 LiveBoard 的业务数据，先按
本文部署并验收空环境，再执行
[旧数据迁移指南](./migrate-data-to-vercel-r2.md)，最后切换正式流量。

> Vercel Hobby 适合个人、非商业项目。学校、公司、收费教学、受薪开发等用途应
> 根据 Vercel 当前条款改用 Pro 或自托管。Hobby 还只有一个并发构建槽，API 与
> Web 同时部署时排队是正常现象。

## 1. 最终架构和数据流

需要创建两个 Vercel Project，但它们连接同一个 GitHub 仓库：

```text
浏览器
  │
  ▼
Vercel Web（Next.js，apps/web）
  ├── /_next/static/*：可选由 Cloudflare Pages 或 EdgeOne Makers 分发
  │  同源 /api/* rewrite
  ▼
Vercel API（NestJS，apps/api，sin1）
  ├── Neon PostgreSQL：持久业务数据
  ├── Upstash Redis：登录限流、AI 限流等临时状态
  └── Cloudflare R2：上传文件和图片

大文件上传：浏览器 ──预签名 PUT──▶ 私有 R2
受保护图片：浏览器 ──▶ API 权限校验 ──302 短期签名──▶ 私有 R2
文档预览：浏览器 ──▶ API 权限校验与流式中转 ──▶ 私有 R2
```

浏览器始终访问 Web 域名下的 `/api`，不直接使用 API 域名。这样 Session Cookie
留在 Web 域名下，也避免跨域登录问题。大文件通过短期预签名 URL 直接上传 R2，
避开 Vercel Function 的请求体限制；安全位图由 API 鉴权后跳转到 120 秒签名
GET，避免下载字节经过 Vercel。PDF、Markdown 与文本预览仍由 API 流式中转，
R2 Bucket 本身保持私有。

favicon 的 API 重定向和 R2 图片响应会在浏览器私有缓存 60 秒，
短于 120 秒签名有效期；这让标签页图标与页面品牌图复用同一签名资源。

## 2. 先明确两种部署路线

### 2.1 全新空实例

本文默认走这条路线：

1. 创建一个空 Neon 数据库。
2. API 构建时执行 `prisma migrate deploy`，在空库中应用当前唯一的
   `00000000000000_baseline_v1` 基线，直接得到完整最新表结构。
3. 单独执行一次生产初始化，创建最高管理员、默认 Workspace 和论坛分类。
4. 验证登录、上传、预览、下载和删除。

这里仍然会使用 Prisma migration 命令创建数据库结构，但不会逐轮重放项目过去
的历史 migration，也不需要运行 `db push`。这是“干净基线”，不是“不建表”。

### 2.2 保留旧实例数据

先完成本文的云端资源和空实例部署，只放测试数据。基础设施全部正常后，再按
[旧数据迁移指南](./migrate-data-to-vercel-r2.md)迁移 PostgreSQL 和对象文件。
正式迁移前应停止旧站写入，并避免在新库中产生需要保留的业务数据。

## 3. 部署前准备

需要以下账号：

- 一个个人 GitHub 账号。
- 一个 Vercel 账号。
- 一个 Neon 账号。
- 一个 Upstash 账号。
- 一个 Cloudflare 账号。
- 可选：一个已接入 DNS 的正式域名。

准备一个密码管理器。部署过程中会生成或取得以下敏感值：

- Neon 数据库连接地址。
- Upstash Redis 密码。
- R2 Access Key ID 与 Secret Access Key。
- `SESSION_SECRET`、`AI_ENCRYPTION_KEY`、`CRON_SECRET`。
- 首次初始化生成的管理员密码。

不要把这些值发到聊天、Issue、PR、截图或日志中。R2 Secret Access Key 通常只
显示一次；一旦泄露，立即轮换对应凭据，并更新 Vercel 环境变量后重新部署。

## 4. 准备 GitHub 部署仓库

团队源仓库是 `HFLive/liveboard`。Vercel Hobby 不能直接连接 GitHub
Organization 拥有的私有仓库时，使用个人账号下的 fork/镜像仓库作为部署源。

推荐先使用最简单的手动流程：

1. 把 `HFLive/liveboard` fork 到个人账号，例如 `cyx2007/liveboard`。
2. Vercel 的两个 Project 都连接这个个人仓库的 `main`。
3. 团队仓库合并新版本后，在个人 fork 页面点击 **Sync fork**。
4. 个人 fork 的 `main` 更新后，Vercel 会自动部署，不需要再写一个“部署
   Vercel”的 GitHub Action。

如果以后希望自动同步，可以增加一个只负责把 `HFLive/liveboard:main` 同步到
个人 fork `main` 的 Action。它只负责同步代码；Vercel 仍通过 Git 集成自动部署。
刚上线时建议先保留手动同步，减少自动覆盖和凭据配置。

## 5. 创建 Neon PostgreSQL

### 5.1 创建项目

建议配置：

- Project name：`liveboard-production`。
- Postgres version：`16`，与本项目本地 `postgres:16-alpine` 保持一致。
- Region：AWS Asia Pacific 1（Singapore），尽量和 API、Redis 放在同一区域。
- Neon Auth：关闭。LiveBoard 使用自己的用户、密码和 Session 系统。

### 5.2 保存两条连接地址

在 Neon 的 Connect 页面分别取得：

- 池化连接地址，主机名通常含 `-pooler`，填入 `DATABASE_URL`。
- 直连地址，主机名不含 `-pooler`，填入 `DIRECT_DATABASE_URL`。

保留 Neon 给出的完整查询参数和 SSL 设置，不要手工删改。运行中的 API 使用池化
地址；构建阶段执行 Prisma migration 时优先使用直连地址。

不要在此时手工建表、执行 `db push` 或导入旧数据。首次 API 构建会对空库应用
基线。

## 6. 创建 Upstash Redis

建议配置：

- Region：Singapore / `ap-southeast-1`。
- TLS/SSL：开启。
- Eviction：关闭。Redis 中的限流状态应在自身 TTL 到期，不应因内存策略被提前
  淘汰。

LiveBoard 使用 Redis 协议连接，不使用 Upstash REST URL/Token。Upstash 控制台
可能显示：

```text
redis-cli --tls -u redis://default:<password>@<endpoint>:6379
```

`redis-cli` 通过额外的 `--tls` 参数启用 TLS；LiveBoard 只读取 URL，所以填入
Vercel 的 `REDIS_URL` 必须改为：

```text
rediss://default:<password>@<endpoint>:6379
```

重点是 `rediss://` 的双 `s`。写成 `redis://` 时 API 可以部署成功，但健康检查会
显示 `redis: unavailable`。

如果 Redis URL 曾完整出现在聊天或截图中，应在 Upstash 控制台轮换数据库凭据，
不要继续使用已暴露的密码。

## 7. 创建私有 Cloudflare R2

### 7.1 Bucket

创建 Bucket，例如 `liveboard-production`：

- Public Development URL（`r2.dev`）：关闭。
- Public Access / 自定义公开域名：不配置。
- Location hint：如控制台可选，优先亚太地区。

“设置 CORS”不会使 Bucket 公开。没有有效签名或服务端密钥时，对象仍不能访问。

### 7.2 Bucket 级访问令牌

创建只绑定该 Bucket 的 **Object Read & Write** R2 API Token，保存：

- Cloudflare Account ID → `R2_ACCOUNT_ID`。
- Bucket 名称 → `R2_BUCKET`。
- Access Key ID → `R2_ACCESS_KEY_ID`。
- Secret Access Key → `R2_SECRET_ACCESS_KEY`。

不要创建全账号管理权限 Token，也不要把 Cloudflare 全局 API Key 填到应用中。

### 7.3 CORS

可以等 Web 的 Vercel 域名和正式域名确定后再设置。Cloudflare Dashboard 的 CORS
JSON 编辑器使用**数组**，不是 `{ "rules": [...] }` 包装对象：

```json
[
  {
    "AllowedOrigins": [
      "https://liveboard-web.vercel.app",
      "https://liveboard.example.com"
    ],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

规则要求：

- Origin 只有协议和主机名，不带路径，不带结尾 `/`。
- 上线过渡期可同时保留 Vercel Web 域名和正式域名。
- `GET` 用于 API 鉴权后跳转的短期图片签名地址，`PUT` 用于浏览器直传。
- 允许 `GET` 不会公开 Bucket；请求仍必须携带有效的 R2 签名。
- Production 不要使用 `AllowedOrigins: ["*"]`。

可复制的模板见
[`deploy/vercel/r2-cors-production.example.json`](../deploy/vercel/r2-cors-production.example.json)。

### 7.4 Lifecycle

增加一条生命周期规则：

- Prefix：`pending/`。
- Expiration：对象创建 1 天后删除。

它只兜底清理中断上传留下的临时对象。不要给整个 Bucket 设置 1 天过期。

## 8. 创建 Vercel API Project

### 8.1 导入项目

在 Vercel 导入个人 GitHub 仓库，创建 API Project：

- Project Name：优先 `liveboard-api`。
- Framework Preset：NestJS；若未自动识别可手动选择 Other/NestJS，以最终构建
  命令为准。
- Root Directory：`apps/api`。
- Include source files outside of the Root Directory：**开启**。
- Node.js Version：`22.x`。

Root Directory 选择器中应点选 `apps/api` 这一层，不要选择仓库根目录、`src`、
`prisma` 或 `scripts`。

Vercel 新建 Monorepo Project 时这个 Root 外文件选项通常默认开启，但不要假设当前
项目一定如此；进入 Root Directory 设置实际确认一次。

Vercel 项目名需要全局/账号内唯一时，可能自动变成 `liveboard-api-tlvx` 一类名称。
这不会影响 Production，后面始终使用控制台显示的真实稳定域名。

### 8.2 Build & Development Settings

Install Command：

```bash
cd ../.. && pnpm install --frozen-lockfile
```

Build Command：

```bash
cd ../.. && pnpm --filter @liveboard/shared build && pnpm --filter @liveboard/api db:generate && pnpm --filter @liveboard/api db:deploy && pnpm --filter @liveboard/api build
```

不要把安装命令填到 Build Command。`cd ../..` 是因为 Vercel Root Directory 已经
位于 `apps/api`，构建需要回到 pnpm workspace 根目录。

API 的 [`vercel.json`](../apps/api/vercel.json) 已固定 Function Region 为
`sin1`，并声明每日存储清理 Cron。

### 8.3 API 环境变量

第一次创建时只勾选 Production。填入：

```text
DEPLOYMENT_TARGET=vercel
DATABASE_URL=<Neon pooled URL>
DIRECT_DATABASE_URL=<Neon direct URL>
REDIS_URL=<Upstash rediss:// URL>
R2_ACCOUNT_ID=<Cloudflare Account ID>
R2_BUCKET=liveboard-production
R2_ACCESS_KEY_ID=<R2 Access Key ID>
R2_SECRET_ACCESS_KEY=<R2 Secret Access Key>
SESSION_SECRET=<独立随机值>
AI_ENCRYPTION_KEY=<独立且长期保存的随机值>
SESSION_COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
WEB_ORIGIN=https://placeholder.invalid
CRON_SECRET=<独立随机值，至少 32 字节>
NODE_ENV=production
```

因为 Web 域名尚未产生，首次可暂时使用
`WEB_ORIGIN=https://placeholder.invalid`。API 部署后不要用这个占位值正式登录；
创建 Web Project 后立即替换。

在本机分别生成三个不同的随机值：

```bash
openssl rand -base64 48
openssl rand -base64 48
openssl rand -base64 48
```

分别用于 `SESSION_SECRET`、`AI_ENCRYPTION_KEY`、`CRON_SECRET`，并保存在密码
管理器。以后迁移旧数据或恢复备份时，必须保留原 `AI_ENCRYPTION_KEY`，否则已
保存的 AI Provider API Key 无法解密。

Vercel 环境不设置任何 `MINIO_*` 变量。

### 8.4 第一次部署

部署完成后记录 API 的稳定域名，例如：

```text
https://liveboard-api-tlvx.vercel.app
```

使用 Project 的稳定域名，不要复制某次 Deployment 的随机预览 URL。

如果日志出现：

```text
Unsupported engine: wanted: {"node":">=22 <23"} (current: {"node":"v24..."})
```

说明 Project 仍在使用 Node 24。到 Settings → Build and Deployment → Node.js
Version 选择 22.x，然后 Redeploy。不要改项目的 engine 去迎合 Node 24。

如果只出现 Prisma 的 `package.json#prisma is deprecated` 警告，这是 Prisma 6
提示未来 Prisma 7 要迁移配置文件，不会导致本次构建失败。

## 9. 创建 Vercel Web Project

再次导入同一个个人 GitHub 仓库，创建 Web Project：

- Project Name：`liveboard-web`。
- Framework Preset：Next.js。
- Root Directory：`apps/web`。
- Include source files outside of the Root Directory：**开启**。
- Node.js Version：`22.x`。
- Function Region：在 Project Settings 中选择 Singapore；静态资源仍由全球 CDN
  分发。

Install Command：

```bash
cd ../.. && pnpm install --frozen-lockfile
```

Build Command：

```bash
cd ../.. && pnpm --filter @liveboard/shared build && pnpm --filter @liveboard/web build
```

Web Production 环境变量：

```text
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_DEPLOYMENT_TARGET=vercel
NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false
API_HOST=https://<API Project 的真实稳定域名>
```

`API_HOST` 不带结尾 `/`，也不附加 `/api`。例如：

```text
API_HOST=https://liveboard-api-tlvx.vercel.app
```

部署后记录 Web 稳定域名，例如
`https://liveboard-web.vercel.app`。

### 9.1 可选：选择 Next.js 静态资源分发服务

如果目标用户访问 Vercel CDN 的 `/_next/static/*` 明显缓慢，可以只把带内容哈希
的 JS、CSS 和字体发布到 Cloudflare Pages 或 Tencent EdgeOne Makers；页面、API
和用户文件的部署位置不变。两个外部项目都只保存公开的浏览器构建文件，不得放入
课程文件、附件、头像或私有 R2 对象。

只在 Vercel Web Project 的 Production 环境设置选择变量：

```text
STATIC_ASSET_PROVIDER=vercel
```

可选值如下：

- `vercel`：默认值，使用 Vercel 原生 `/_next/static/*`，不执行外部上传。
- `cloudflare`：使用 Cloudflare Pages。
- `edgeone`：使用 Tencent EdgeOne Makers。

两套外部服务配置可以同时保留。完成首次配置后，回退或切换只需修改
`STATIC_ASSET_PROVIDER` 并重新部署 Web；不要同时删除另一套配置，避免紧急回退时
还要重建 Secret。

#### Cloudflare Pages

1. 创建 Direct Upload Project `liveboard-static`。
2. 在 Pages Project 添加 `static.hsfz.live`。如果域名由 DNSPod 等外部 DNS
   托管，只需添加 `static` 到 `liveboard-static.pages.dev` 的 CNAME，不需要修改
   Nameserver。
3. 创建最小权限 API Token：`Account / Cloudflare Pages / Edit`，不授予 DNS、
   R2 或 Workers 权限。
4. 在 Web Production 增加：

   ```text
   CLOUDFLARE_PAGES_ASSET_ORIGIN=https://static.hsfz.live
   CLOUDFLARE_PAGES_PROJECT=liveboard-static
   CLOUDFLARE_ACCOUNT_ID=<Cloudflare Account ID>
   CLOUDFLARE_API_TOKEN=<Cloudflare Pages Edit Token>
   ```

#### Tencent EdgeOne Makers

1. 在腾讯云国际版 EdgeOne 控制台进入 Makers，创建 Direct Upload Project
   `liveboard-static-eo`。无备案域名选择 `Global (excluding Chinese Mainland)`。
2. 首次上传内容的根目录必须包含 `index.html`，静态资源保持
   `_next/static/*` 结构；项目创建后由 CLI 自动部署后续版本。
3. 添加 `static-eo.hsfz.live` 并按控制台提示在 DNSPod 配置 CNAME；在 HTTPS
   一栏申请并部署免费证书。
4. 在 Makers 控制台创建 API Token，然后在 Web Production 增加：

   ```text
   EDGEONE_ASSET_ORIGIN=https://static-eo.hsfz.live
   EDGEONE_PROJECT_NAME=liveboard-static-eo
   EDGEONE_API_TOKEN=<EdgeOne Makers API Token>
   ```

所有 Token 都必须设置为 Sensitive，不能写入 Git、文档、聊天或任何
`NEXT_PUBLIC_*` 变量。`NEXT_PUBLIC_ASSET_PREFIX` 仅保留用于兼容已经部署的旧
Cloudflare 配置；新部署不要设置它。

[`apps/web/scripts/deploy-static-assets.mjs`](../apps/web/scripts/deploy-static-assets.mjs)
由 Web 的 `postbuild` 自动调用。它仅在 `VERCEL=1` 且
`VERCEL_ENV=production` 时执行，复制**本次相同构建**的 `.next/static`，写入一年
`immutable` 缓存与跨域响应头，再上传到当前 provider。上传、凭据或配置校验失败
会让 Vercel 构建失败。上传后脚本还会通过当前正式静态域名读取一个本次构建文件并
逐字节比对，防止项目名错误、域名未关联到新部署或证书异常时继续上线。本地、
Preview、自托管构建和 `STATIC_ASSET_PROVIDER=vercel` 都会明确跳过外部上传。

切换后，从新部署 HTML 中复制任一实际构建文件名并检查：

```bash
curl -I https://<当前静态域名>/_next/static/chunks/<实际文件名>.js
```

预期至少包含 `200`、正确的 JavaScript Content-Type，以及：

```text
Cache-Control: public, max-age=31536000, immutable
Access-Control-Allow-Origin: *
```

最后必须从目标用户的真实网络分别测试完整页面，而不只比较服务商默认域名。无备案
时 EdgeOne 也只能使用不含中国大陆的节点，不能把 Cloudflare 或 EdgeOne 方案描述
为中国大陆 CDN。

## 10. 补齐 Web、API 和 R2 的正式 Origin

Web 部署成功后完成闭环：

1. API Project 的 `WEB_ORIGIN` 改为 Web 稳定域名：

   ```text
   WEB_ORIGIN=https://liveboard-web.vercel.app
   ```

2. 如果正式域名已确定，可用英文逗号同时保留两个 Origin：

   ```text
   WEB_ORIGIN=https://liveboard-web.vercel.app,https://liveboard.example.com
   ```

3. 保存后重新部署 API。只改环境变量不会改变已经运行的旧 Deployment。
4. 按第 7.3 节把相同 Web Origin 加入 R2 CORS。
5. 如果 Web 的 `API_HOST` 有修改，也重新部署 Web。

`WEB_ORIGIN` 中每项都不带路径和结尾 `/`。

先访问：

```text
https://<Web 域名>/api/health
```

预期：

```json
{
  "ok": true,
  "service": "liveboard-api",
  "dependencies": {
    "postgres": "ok",
    "redis": "ok",
    "storage": "ok"
  }
}
```

只有三项都为 `ok` 才继续初始化管理员。

## 11. 安全执行一次生产管理员初始化

Vercel 部署不会自动执行 `seed.cjs`，也不会自动创建生产管理员。健康检查全部正常
后，在可信本机仓库中执行一次
[`bootstrap-production.ts`](../apps/api/src/bootstrap-production.ts)。使用 Neon
**直连**地址，输入内容不会回显：

```bash
cd /Users/xiang/Desktop/liveboard
read -s "LIVEBOARD_BOOTSTRAP_DATABASE_URL?粘贴 Neon 直连地址（输入不会显示）: "
echo
DATABASE_URL="$LIVEBOARD_BOOTSTRAP_DATABASE_URL" pnpm --filter @liveboard/api exec tsx src/bootstrap-production.ts --machine-readable
unset LIVEBOARD_BOOTSTRAP_DATABASE_URL
```

输出会包含 `CREATED=1`、管理员用户名和随机密码。立即把密码保存到密码管理器，再
执行：

```bash
clear
```

初始化脚本只在没有用户的空库中创建：

- 一个 `super_admin` 管理员。
- 默认 Workspace。
- 默认论坛分类。

再次运行时应得到 `CREATED=0`，不会覆盖已有管理员。生产环境不要运行本地演示
seed。

第一次打开登录页时，左上角默认 `LB` 标志可能暂时不显示。这是因为初始化前
数据库还没有 Workspace，`/settings/public` 无法返回站点配置；初始化创建
Workspace 后默认标志才出现，与“修改管理员密码”本身无关。

首次登录后立即：

1. 修改管理员密码。
2. 确认退出再登录成功。
3. 开启 GitHub、Vercel、Neon、Upstash 和 Cloudflare 的 MFA。

### 忘记保存初始化密码

终端 `clear` 只清屏，不会撤销已创建的管理员，也无法从数据库恢复明文密码。可以
在可信本机为 `admin` 重置一个至少 16 位的新密码：

```bash
cd /Users/xiang/Desktop/liveboard
read -s "LIVEBOARD_NEW_ADMIN_PASSWORD?输入已保存的新密码（不会显示）: "
echo
read -s "LIVEBOARD_ADMIN_RESET_DATABASE_URL?粘贴 Neon 直连地址（不会显示）: "
echo
DATABASE_URL="$LIVEBOARD_ADMIN_RESET_DATABASE_URL" \
LIVEBOARD_NEW_ADMIN_PASSWORD="$LIVEBOARD_NEW_ADMIN_PASSWORD" \
pnpm --filter @liveboard/api exec node - <<'NODE'
const { PrismaClient } = require("@prisma/client");
const argon2 = require("argon2");

const prisma = new PrismaClient();

async function main() {
  const password = process.env.LIVEBOARD_NEW_ADMIN_PASSWORD;
  if (!password || password.length < 16) {
    throw new Error("新密码必须至少 16 位");
  }

  const user = await prisma.user.findUnique({
    where: { username: "admin" },
    select: { id: true, systemRole: true },
  });
  if (!user) throw new Error("没有找到 admin 用户");
  if (user.systemRole !== "super_admin") {
    throw new Error("admin 不是最高管理员，已停止操作");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await argon2.hash(password),
      sessionVersion: { increment: 1 },
      status: "active",
    },
  });
  console.log("管理员密码已成功重置，旧会话已失效。");
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
NODE
unset LIVEBOARD_NEW_ADMIN_PASSWORD
unset LIVEBOARD_ADMIN_RESET_DATABASE_URL
clear
```

## 12. 绑定正式域名

只把用户访问的正式域名绑定到 **Web Project**。API 不需要公开绑定同一个域名，
因为 Web 已把 `/api/*` 同源转发到 API Project。

1. Vercel Web Project → Settings → Domains，添加正式域名。
2. 在 DNS 服务商按 Vercel 页面显示的记录配置，不要凭旧教程猜 A/CNAME 值。
3. 如果 DNS 托管在 Cloudflare，初次验证和签发证书时建议使用 DNS only（灰云）。
4. 等待 Vercel 显示域名和证书有效。
5. API `WEB_ORIGIN` 加入正式域名并 Redeploy API。
6. R2 CORS 加入正式域名。

Web 的 `API_HOST` 仍然指向 API Project 的稳定 `.vercel.app` 域名，不改成正式 Web
域名，否则会形成 rewrite 自循环。

从 `.vercel.app` 切到正式域名后需要重新登录是正常的：Cookie 属于不同主机，旧
域名的登录态不会自动复制到新域名。

## 13. Cron、区域和访问速度

[`apps/api/vercel.json`](../apps/api/vercel.json) 已配置：

```text
GET /internal/cron/storage-cleanup
3 4 * * *
```

Vercel 会携带 `Authorization: Bearer <CRON_SECRET>`。部署后在 Vercel Cron Jobs
中确认任务已识别；不要从浏览器公开调用内部清理接口。

API 固定在 `sin1`，Neon 与 Upstash 也应选择 Singapore，以减少每次 API 请求的
数据库/Redis 往返。Web Function 同样选 Singapore；静态 JS/CSS/图片仍由 Vercel
全球 CDN 分发。

Vercel Hobby 通常只能选择单个 Function Region。中国大陆访问仍可能受跨境网络、
冷启动和第三方服务影响。排查“慢”时先看浏览器 Network：

- Document/静态资源慢：更可能是 CDN、DNS 或跨境网络。
- `/api/*` 慢：检查 Vercel Function 日志、冷启动和 Neon/Upstash 区域。
- 文件上传慢：检查客户端到 R2 的网络，而不是 Vercel API Region。

不要只为靠近浏览器把 API 改到香港，而数据库和 Redis 仍在新加坡；这会让每次
数据库访问增加跨区往返，整体可能更慢。

免费托管还可能引入额外冷启动：Neon Compute 闲置后可能自动休眠，第一条数据库
连接会比后续请求慢；Upstash 免费数据库长期无活动时可能被归档，并会事先发送
提醒邮件。不要把偶发第一次慢误判成 Region 配错，也不要忽略平台的额度和归档
通知。

## 14. 完整生产验收

### 14.1 基础设施

- Web 首页可打开。
- `https://<Web 域名>/api/health` 的 PostgreSQL、Redis、Storage 全部为 `ok`。
- API 和 Web Deployment 使用同一个 Git commit。
- API Function Region 是 `sin1`，Node 是 22.x。
- R2 `r2.dev` 和公开自定义域名保持关闭。
- Vercel 的 Production 环境没有任何 `MINIO_*` 变量。

### 14.2 数据库基线

在 Neon SQL Editor 执行：

```sql
SELECT migration_name, finished_at
FROM "_prisma_migrations"
ORDER BY finished_at;
```

全新部署应只有：

```text
00000000000000_baseline_v1
```

再检查管理员：

```sql
SELECT username, "systemRole", status
FROM "User";
```

应至少有一个状态正常的 `super_admin`。

### 14.3 登录与 Cookie

- 正式域名登录成功，刷新页面后会话仍在。
- 修改密码后旧会话失效，新密码可重新登录。
- Cookie 应为 Secure、HttpOnly、SameSite=Lax。
- Production 登录页不显示演示账号。

### 14.4 R2 文件链路

先上传一个小测试文件，再上传一个 10–50 MB 文件，逐项验证：

- 上传进度正常，浏览器请求直接发往 R2。
- 支持的 PDF/Markdown/TXT 可以预览。
- 下载成功。
- 删除后页面记录和 R2 对象按业务规则清理。
- 浏览器控制台没有 R2 CORS 错误。

生产切流前还应检查头像、站点图标、论坛图片和课堂文件等实际使用入口。

### 14.5 安全与恢复

- 所有平台启用 MFA。
- 凭据进入密码管理器，没有写入 Git。
- Neon 已配置与业务重要性匹配的备份/PITR 策略。
- R2 重要对象有独立备份或复制方案；R2 不是备份本身。
- `AI_ENCRYPTION_KEY` 有独立安全备份。

## 15. 日常发布：手动还是自动

当前推荐流程是“手动同步代码，Vercel 自动部署”：

1. 在 `HFLive/liveboard` 提交并合并 PR。
2. 确认团队仓库 `main` 的 CI 通过。
3. 到个人 fork 点击 **Sync fork**。
4. Vercel 看到个人 fork `main` 更新后，自动构建 API 和 Web。
5. 检查两个 Production Deployment 和 `/api/health`。

这里没有第二次手动上传，也不需要一个 Vercel Deployment Action。以后若增加
GitHub Action，它只替代第 3 步的“Sync fork”，第 4 步仍由 Vercel Git 集成完成。

同一次提交可能在 Vercel 列表中出现旧 Production 和一次手动 Redeploy 两条
`Ready` 记录。不要删除：带当前 Production 标记的最新 Deployment 正在服务，
旧记录用于回滚。

## 16. Preview 环境是可选项

先把 Production 上线，不要为了 Preview 阻塞首次部署。真正安全的 Preview 需要
完全独立的：

- Neon 数据库。
- Upstash Redis。
- R2 Bucket 和 Token。
- `SESSION_SECRET`、`AI_ENCRYPTION_KEY`、`CRON_SECRET`。

每次 API Preview 构建也会执行 migration，因此绝不能把 Preview 的
`DIRECT_DATABASE_URL` 指向生产库。

Web 的 [`vercel.json`](../apps/web/vercel.json) 当前没有绑定账户专属的 Related
Project ID。Production 可通过 `API_HOST` 正常工作；Preview 故意禁止回退到
Production API，避免预览代码读写正式数据。

以后启用 Preview 时：

1. 为 API Preview 配置独立基础设施和环境变量。
2. 在 Web Project 配置对应的 Vercel Related Project。
3. 把真实 API Project ID 写入个人部署 fork 的 `relatedProjects`。
4. 确保 API Project 名与
   [`next.config.mjs`](../apps/web/next.config.mjs) 中的 `liveboard-api` 一致。

如果 Vercel 把项目命名成 `liveboard-api-tlvx`，Production 的 `API_HOST` 只需使用
真实域名；启用 Preview 前则应把项目重命名为 `liveboard-api`，或同步修改代码中
的 Related Project 名称。

## 17. 旧数据迁移不是首次部署前提

只有需要保留旧站内容时才执行
[旧数据迁移指南](./migrate-data-to-vercel-r2.md)。推荐顺序：

1. 按本文创建并验收全新的云端空环境。
2. 清除仅用于验收的测试业务数据，或重新创建干净目标资源。
3. 备份旧 PostgreSQL 和 MinIO/OSS。
4. 停止旧站写入。
5. 迁移 PostgreSQL 数据和对象文件。
6. 运行迁移校验，确认对象缺失数为 0、管理员和 AI 配置可用。
7. 重新部署并做最终业务验收。
8. 切换正式域名；旧环境保留一段只读回滚窗口。

如果旧数据库中保存过 AI Provider 配置，新环境必须沿用旧
`AI_ENCRYPTION_KEY`。`SESSION_SECRET` 可以更换，但会要求所有用户重新登录。

## 18. 本次部署中遇到的坑与解决方案

### 健康检查显示 `redis: unavailable`

最常见原因是把 Upstash 示例中的 `redis://` 原样填入。改为 `rediss://`，确认变量
作用域包含 Production，保存后 Redeploy API。仍失败时查看 API Runtime Logs，
检查端点、密码、6379 端口和 TLS，而不是改用 REST Token。

### Vercel 使用 Node 24 并警告 engine 不支持

Node 版本不是从 Root Directory 选择器设置。进入每个 Project 的 Settings →
Build and Deployment，把 Node.js Version 明确设为 22.x，再 Redeploy。API 和 Web
都要设置。

### 不知道 Root Directory 选哪一层

API 选择 `apps/api`，Web 选择 `apps/web`。两者都开启 Include source files
outside of the Root Directory，因为构建还需要仓库根目录的 workspace 和
`packages/shared`。

### 安装命令填到了 Build Command

Install Command 只放 `pnpm install`；Build Command 放 shared build、Prisma 和
应用 build。两者都从 `apps/*` 用 `cd ../..` 回到仓库根目录。

### Prisma `package.json#prisma` deprecation 警告

这是 Prisma 6 的未来兼容提示，不是部署失败原因。只有出现实际 error 或构建退出
码非 0 才需要阻塞上线。

### Project Name 自动多了随机后缀

说明期望名称不可用。Production 直接使用实际稳定 API 域名作为 `API_HOST` 即可。
只有 Related Projects/Preview 依赖代码中的项目名，需要按第 16 节对齐。

### R2 控制台拒绝 CORS JSON

Cloudflare Dashboard 要求顶层是数组 `[...]`。不要粘贴旧格式
`{ "rules": [...] }`。同时检查 Origin 无结尾 `/`，方法为 `PUT`，Header 包含
`Content-Type`。

### R2 已设 CORS，仍担心是否公开

CORS 只限制浏览器从哪些网页 Origin 发起请求，不授予对象读取权限。只要
`r2.dev`、公开 Bucket 和公共自定义域名关闭，对象仍是私有的。

### 修改环境变量后健康检查仍是旧结果

Vercel 环境变量只影响新 Deployment。确认变量勾选了 Production，然后 Redeploy
对应 Project。仅保存变量不会热更新正在运行的 Function。

### Vercel 出现两条相同提交的 Production Deployment

通常是一条 Git 自动部署和一条手动 Redeploy。保留即可；最新且带当前 Production
标记的一条负责流量，旧条目可以用于回滚。

### 初始化前左上角 `LB` 不显示

空库没有 Workspace，公开站点设置接口暂时没有配置可返回。运行生产初始化后会
创建默认 Workspace，刷新页面后默认 `LB` 出现。这不是 Logo 文件加载失败。

### `API_HOST` 是否加结尾 `/`

不加，也不要加 `/api`。正确示例是
`https://liveboard-api-tlvx.vercel.app`。

### 绑定正式域名后需要重新登录

正常。`.vercel.app` 与正式域名拥有不同 Cookie 空间。在正式域名重新登录一次。

### Vercel 部署 Ready，但 `/api/health` 返回 503

Ready 只代表构建和 Function 发布成功，不代表外部依赖全部可用。根据 health 中
失败项分别检查 Neon、Upstash 或 R2，并查看 API Runtime Logs。不要在依赖未全绿
时运行管理员初始化。

### 管理员密码在 `clear` 后找不到

密码无法从 hash 还原。使用第 11 节的受限脚本重置 `admin` 密码；脚本还会增加
`sessionVersion`，使旧会话失效。不要重新运行 seed，也不要删除数据库重来。

## 19. 最终上线清单

- [ ] 个人 GitHub fork 已连接 Vercel，团队仓库仍是代码源。
- [ ] Neon 使用 PostgreSQL 16、Singapore，已保存 pooled/direct 两条 URL。
- [ ] Upstash 在 Singapore，Eviction 关闭，`REDIS_URL` 使用 `rediss://`。
- [ ] R2 Bucket 私有，Token 只限目标 Bucket，CORS 是正式 Origin 数组格式。
- [ ] API Root 是 `apps/api`，Web Root 是 `apps/web`，均允许读取 Root 外文件。
- [ ] 两个 Project 均使用 Node 22.x。
- [ ] API/Web Install 与 Build Command 填在正确栏位。
- [ ] API 三个随机密钥彼此不同且已安全备份。
- [ ] Web `API_HOST` 使用真实 API 稳定域名且没有结尾 `/api` 或 `/`。
- [ ] API `WEB_ORIGIN` 包含当前 Web 域名，修改后已 Redeploy。
- [ ] `/api/health` 的 PostgreSQL、Redis、Storage 全部为 `ok`。
- [ ] 生产初始化只执行一次，管理员密码已保存并修改。
- [ ] Neon 中只有 baseline migration，并存在正常最高管理员。
- [ ] 小文件和 10–50 MB 文件的上传、预览、下载、删除全部通过。
- [ ] 正式域名只绑定 Web，API Origin 与 R2 CORS 已同步更新。
- [ ] 已决定暂时手动 Sync fork；未把“代码同步”和“Vercel 部署”混为一件事。
- [ ] 如需旧数据，等空环境验收后再按独立迁移指南执行。

## 20. 官方参考

- [Vercel Plans 与 Hobby 用途](https://vercel.com/docs/plans)
- [Vercel Git 部署与 Hobby 私有组织仓库限制](https://vercel.com/docs/git)
- [Vercel Monorepos](https://vercel.com/docs/monorepos)
- [Vercel Monorepos FAQ](https://vercel.com/docs/monorepos/monorepo-faq)
- [Vercel Functions Regions](https://vercel.com/docs/functions/configuring-functions/region)
- [Vercel Environment Variables](https://vercel.com/docs/environment-variables)
- [Vercel Custom Domains](https://vercel.com/docs/domains/working-with-domains/add-a-domain)
- [Neon connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Upstash Redis TLS connections](https://upstash.com/docs/redis/howto/connectwithrediscli)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare R2 lifecycle rules](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)
