# LiveBoard 部署到 Vercel Hobby + Cloudflare R2

本文面向把 LiveBoard 部署到 Vercel Hobby 的工程师。前提是先完成
[数据迁移](./migrate-data-to-vercel-r2.md)，把现有 PostgreSQL 业务数据与
MinIO/OSS 对象迁移到 Vercel 环境。

> 重要：Vercel Hobby 只允许个人、非商业用途。如果 LiveBoard 用于学校、
> 公司、收费教学，或开发过程涉及受薪员工/顾问，请改用 Vercel Pro 或继续
> 采用自托管部署。

## 1. 前置条件

- Vercel Hobby 账号。
- 个人 GitHub 账号名下的私有镜像仓库。Vercel Hobby 不支持连接
  GitHub Organization 拥有的仓库，因此 `HFLive/liveboard` 需要通过人工或
  GitHub Actions 同步到个人镜像。
- 托管 PostgreSQL（推荐 Neon Singapore）。
- 托管 Redis（推荐 Upstash Singapore）。
- Cloudflare R2 Bucket（Production 与 Preview 各一个）。

## 2. 创建 Vercel Project

创建两个 Project，都连接个人镜像仓库，Root Directory 分别指向
`apps/api` 和 `apps/web`，Node.js 22，两个 Project 都开启
“Include source files outside of the Root Directory”。

1. `liveboard-api`
   - Root Directory：`apps/api`
   - Framework：NestJS
   - Function Region：`sin1`
2. `liveboard-web`
   - Root Directory：`apps/web`
   - Framework：Next.js

创建 API Project 后，在 Vercel 控制台取得真实 `prj_*` ID，写入
`apps/web/vercel.json` 的 `relatedProjects`（提交代码前必须用真实 ID 替换，
不允许提交 `prj_REPLACE_ME` 占位符）。

## 3. Vercel 环境变量

API Project（Preview 与 Production 使用各自独立的值）：

```text
DEPLOYMENT_TARGET=vercel
DATABASE_URL=<pooled postgres url>
DIRECT_DATABASE_URL=<direct postgres url>
REDIS_URL=<rediss url>
R2_ACCOUNT_ID=<cloudflare account id>
R2_BUCKET=<environment-specific private bucket>
R2_ACCESS_KEY_ID=<bucket-scoped token id>
R2_SECRET_ACCESS_KEY=<bucket-scoped token secret>
SESSION_SECRET=<random secret>
AI_ENCRYPTION_KEY=<稳定随机密钥>
SESSION_COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
WEB_ORIGIN=https://<production web domain>
CRON_SECRET=<至少 32 字节的随机密钥>
NODE_ENV=production
```

Web Project：

```text
NEXT_PUBLIC_API_URL=/api
NEXT_PUBLIC_DEPLOYMENT_TARGET=vercel
# 只为 Production 设置；Preview 必须依赖 Related Projects，禁止回退正式 API
API_HOST=https://<stable production api host>
NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false
```

要点：

- Production 必须沿用旧环境的 `AI_ENCRYPTION_KEY`，否则迁移过来的 AI
  Provider API Key 无法解密。
- `SESSION_SECRET` 可以更换；更换会使旧 Session 失效，用户重新登录即可。
- Preview 与 Production 的数据库、Redis、R2 Bucket、`SESSION_SECRET`、
  `AI_ENCRYPTION_KEY`、`CRON_SECRET` 必须完全隔离。
- `API_HOST` 只配置在 Production。Preview 若没有正确的 Related Projects 配对，
  Web 构建会直接失败，避免误连 Production API。
- 所有密钥只通过 Vercel Secret Environment Variables 提供，禁止
  `NEXT_PUBLIC_*`，禁止写入代码、日志或文档真实值。

## 4. 构建配置

两个 Project 的安装命令均从 workspace 根目录执行：

```bash
cd ../.. && pnpm install --frozen-lockfile
```

API 构建顺序：

```bash
pnpm --filter @liveboard/shared build
pnpm --filter @liveboard/api db:generate
pnpm --filter @liveboard/api db:deploy
pnpm --filter @liveboard/api build
```

`db:deploy` 会优先把 `DIRECT_DATABASE_URL` 临时作为 Prisma migration 连接，
应用运行时仍使用池化的 `DATABASE_URL`；未提供直连地址时会明确警告并回退。

Web 构建顺序：

```bash
pnpm --filter @liveboard/shared build
pnpm --filter @liveboard/web build
```

注意：Preview 必须使用独立数据库，否则 Preview 构建会对生产库执行 migration。

## 5. Cloudflare R2 配置

创建 `liveboard-production` 与 `liveboard-preview` 两个私有 Bucket，都
禁用公共 `r2.dev`。每个 Bucket 使用独立的 Bucket-scoped Object Read/Write
Token。

CORS（参考 `deploy/vercel/r2-cors-production.example.json`）：

- Production 只允许正式 Web Origin 的 `PUT`，暴露 `ETag`。
- Preview 可以允许全部 Origin 的 `PUT`，暴露 `ETag`；安全边界由私有
  Bucket、60 秒有效预签名 URL、随机 Key 与 Confirm 校验共同提供。

Lifecycle：临时上传对象统一以 `pending/` 开头，配置删除一天以上
`pending/` 前缀对象的规则。正式业务对象不能位于 `pending/` 前缀。

## 6. 同源 /api 路由

`apps/web/next.config.mjs` 通过 `@vercel/related-projects` 在构建时解析
`liveboard-api` 的对应环境 Host，把 `/api/:path*` rewrite 到 API；缺失时
回退 `API_HOST`。浏览器只访问 Web 域名下的同源 `/api`，Session Cookie
保持在 Web 域名下。

本地开发继续使用 `NEXT_PUBLIC_API_URL=http://localhost:4000`，不走 Vercel
rewrite。

## 7. 上传与下载

- 大文件（独立文件、课堂文件、论坛图片、Banner）由浏览器直接上传 R2，
  不经过 Vercel Function Body（普通请求/响应体上限 4.5MB）。
- 头像、favicon、Markdown 导入仍可经过 API，对象最终写入 R2。
- 附件下载优先 302 到 R2 预签名 GET；PDF、图片等 inline 资源继续由 API
  流式中转并重新校验权限。
- 每日一次 Cron `GET /internal/cron/storage-cleanup` 配合惰性清理与 R2
  Lifecycle 清理过期上传。

## 8. 定时任务

`apps/api/vercel.json` 配置每天一次的 UTC Cron。Vercel Cron 会携带
`Authorization: Bearer ${CRON_SECRET}`，API 使用恒定时间比较校验。

## 9. 上线检查清单

1. 两个 Project 部署同一 Git 提交，Web `/api/health` 命中同一提交的 API。
2. API Region 为 `sin1`。
3. Session Cookie 为 Secure、HttpOnly、SameSite=Lax。
4. R2 Bucket 保持私有，无签名 URL 无法上传/下载。
5. 上传 50MB 独立文件、100MB 课堂文件、10MB 论坛图片、5MB Banner 均成功。
6. 浏览器断开后 AI 上游请求被取消；110 秒超时返回明确错误。
7. `_prisma_migrations` 只有唯一 baseline，`prisma migrate status` 无 pending。
8. 至少一名迁移过来的正常最高管理员可以登录，AI 配置可用原
   `AI_ENCRYPTION_KEY` 解密。
9. 数据迁移验证工具 `verify-vercel-data-migration` 全部 PASS，R2 缺失对象数为 0。
