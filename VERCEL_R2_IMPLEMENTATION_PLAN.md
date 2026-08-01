# LiveBoard Vercel Hobby + Cloudflare R2 完整适配实施方案

> 文档状态：实施前方案
> 目标读者：负责实际修改代码的工程师或代码代理
> 适用基线：2026-08-01 当前仓库
> 本文只描述实施方案，不代表相关代码已经完成。

## 0. 结论与实施边界

采用“双目标部署”并保留现有自托管能力：

- Vercel：`apps/web` 和 `apps/api` 分别部署为两个 Vercel Project；PostgreSQL、Redis 使用托管服务；对象存储固定为 Cloudflare R2。
- 自托管：现有 Docker Compose、MinIO、阿里云 OSS、`.run` 发布包、Nginx 和 HTTPS 助手继续可用。
- Vercel 下 R2 配置只允许来自环境变量；管理中心只能查看状态和配置说明，不能保存、切换或显示凭据。
- Vercel 大文件上传必须由浏览器直接上传 R2，不能经过 NestJS multipart。
- R2 使用预签名 `PUT`，不能复用当前阿里云 OSS 的 HTML Form POST Policy。
- Preview、Production 必须使用彼此独立的数据库、Redis、R2 Bucket 和密钥。
- 正式 Vercel 环境不是空项目：必须迁移现有 PostgreSQL 业务数据以及 MinIO/OSS 对象。
- 不迁移旧 Prisma migration 历史；最终仓库和新生产数据库只保留一个代表最终 schema 的 baseline migration。

### 数据迁移与干净基线目标

本项目当前有 41 个历史 migration。目标不是永久放弃 migration，而是进行一次安全的 migration squash 和生产数据库 baseline：

- 旧生产数据库和旧对象存储保持不动，作为可回滚来源。
- 新建干净的目标 PostgreSQL，恢复全部有效业务数据，但不恢复旧 `_prisma_migrations` 数据。
- 新增可恢复执行的对象迁移工具，把数据库引用的 MinIO/OSS 对象复制到 R2；单个对象验证成功后才把对应记录的 `storageBackend` 改为 `r2`。
- 等所有 Vercel/R2 schema 修改完成后，从最终 `schema.prisma` 生成唯一的 `00000000000000_baseline_v1`。
- 目标数据库通过 `prisma migrate resolve --applied 00000000000000_baseline_v1` 标记基线，不重复执行建表 SQL。
- 后续功能继续创建正常的增量 migration；新环境只需执行一个 baseline 加其后的少量增量，而不再回放旧的 41 个 migration。
- 旧 migration 在从主分支移除前必须由 Git tag/历史保留，禁止重写或销毁旧仓库历史。

### Vercel Hobby 前置限制

当前仓库远程地址为 `https://github.com/HFLive/liveboard.git`，`HFLive` 是 GitHub Organization。Vercel Hobby 不支持连接 GitHub Organization 拥有的仓库，因此免费部署必须先满足以下条件：

1. 创建个人 GitHub 账号名下的私有镜像仓库。
2. `liveboard-web` 和 `liveboard-api` 两个 Vercel Project 均连接该个人仓库。
3. `HFLive/liveboard` 继续作为正式主仓库，通过人工或 GitHub Actions 同步到个人镜像。
4. 不使用纯 CLI 部署替代 Git Integration，因为 Vercel Related Projects 不支持 CLI Deployment。

此外，Vercel Hobby 仅允许个人、非商业用途。如果 LiveBoard 用于学校、公司、收费教学，或开发过程涉及受薪员工/顾问，应改用 Vercel Pro 或继续采用自托管部署。

Hobby 技术约束按以下方式固化：

- Fluid Compute 保持启用；单个函数最长 300 秒。
- Web 到 API 的跨 Project rewrite 存在 120 秒代理上限，因此 AI 上游超时固定为 110 秒，不能承诺超过两分钟的单次回答。
- Vercel Cron 每天最多运行一次；上传清理由“每日 Cron + 请求时惰性清理 + R2 Lifecycle”共同完成。
- 两个 Project 只有一个并发构建槽，允许串行构建，不应假定 Web/API 会同时完成部署。
- Hobby 超额后不能购买额外用量，必须监控函数调用、CPU、内存和流量额度。

## 1. 当前架构和相关代码路径

### 1.1 Monorepo

- `apps/web`：Next.js 15 App Router 前端。
- `apps/api`：NestJS 11 API。
- `packages/shared`：前后端共享类型、校验和纯函数。
- 根目录使用 pnpm workspace，Node.js 版本范围为 `>=22 <23`。
- `apps/web` 和 `apps/api` 均显式依赖 `@liveboard/shared`，Vercel 构建时必须允许读取 Root Directory 之外的源码。

### 1.2 Web 请求入口

- `apps/web/lib/api/client.ts`
  - 定义 `API_URL`。
  - 当前默认值为 `NEXT_PUBLIC_API_URL ?? "http://localhost:4000"`。
  - 集中处理携带 Cookie 的 fetch/XHR。
- `apps/web/lib/api/index.ts`
  - 前端 API 类型和领域级调用入口。
  - 当前存储类型只包含 `minio | oss`。
- `apps/web/middleware.ts`
  - 根据 Session Cookie 名称处理 Web 导航状态。
  - 不验证 Cookie 签名；最终鉴权仍由 API 完成。
- `apps/web/next.config.mjs`
  - 需要新增同源 `/api` rewrite 和 Related Projects 解析。

### 1.3 API 入口和会话

- `apps/api/src/main.ts`
  - 初始化 Nest、CORS、Cookie Parser、Trust Proxy、ValidationPipe，并监听 `API_PORT`。
- `apps/api/src/app.module.ts`
  - 注册 Prisma、Health、Auth、Files、Forum、Storage、AI、Server Status、Settings 等模块。
- `apps/api/src/common/session-cookie.ts`
  - HMAC 签名 Session Cookie。
  - Cookie 为 HttpOnly、SameSite=Lax；Secure 由生产环境配置决定。
- 非公开 API 由全局活动用户守卫验证账号状态和 `sessionVersion`。

### 1.4 数据库

- `apps/api/prisma/schema.prisma`
  - PostgreSQL + Prisma 6。
  - `StorageBackend` 当前只有 `minio` 和 `oss`。
  - 用户头像/Banner、站点 favicon、FileAsset、ClassroomFile 等记录分别保存自己的 `storageBackend`。
  - `PendingUploadKind` 当前只有 `asset`、`classroom`。
  - `PendingUpload` 当前未记录实际使用的存储后端，也没有论坛帖子关联。
- 所有 schema 修改必须提交 Prisma migration，不允许使用 `db push`。

### 1.5 对象存储

- `apps/api/src/modules/storage/storage-backend.ts`
  - 定义 `putObject`、`getObject`、`removeObject`、`statObject`、健康检查和签名接口。
- `apps/api/src/modules/storage/minio-storage.backend.ts`
  - 对接自托管 MinIO。
- `apps/api/src/modules/storage/oss-storage.backend.ts`
  - 通过 MinIO SDK 对接阿里云 OSS。
  - 直传使用 HTML Form POST Policy。
- `apps/api/src/modules/storage/storage.service.ts`
  - 当前构造时无条件初始化 MinIO；这会让未配置 MinIO 的 Vercel 实例启动失败。
  - 当前设置缓存存在函数进程内，适用于短期缓存，但不能作为跨实例一致性来源。
  - `presignDownload()` 已经把 inline 资源固定为 API 中转，把明确附件下载保留为签名直出。

### 1.6 上传入口和上限

- `apps/api/src/modules/files/files.controller.ts`
  - 独立文件上限 50 MB。
  - 已有 `/assets/upload-url`、`upload-confirm`、`upload-abort`。
- `apps/api/src/modules/classrooms/classrooms.controller.ts`
  - 课堂文件上限 100 MB。
  - 已有两阶段上传接口。
- `apps/api/src/modules/forum/forum.controller.ts`
  - 论坛图片每张上限 10 MB。
  - 当前通过 multipart 经 API 上传。
- `apps/api/src/modules/auth/auth.controller.ts`
  - 头像上限 2 MB。
  - Banner 上限 5 MB。
  - 当前均通过 multipart 经 API 上传。
- `apps/api/src/modules/settings/settings.controller.ts`
  - favicon 上限 1 MB，当前通过 multipart 经 API 上传。
- PDF 预览上限 25 MB，Markdown/TXT 预览上限 2 MB。

### 1.7 不适用于 Serverless 的逻辑

- `apps/api/src/modules/server-status/server-status.service.ts`
  - 使用常驻 `setInterval` 采集宿主机 CPU、内存和磁盘。
- `apps/api/src/modules/server-status/server-metrics.collector.ts`
  - 使用 `node:os` 和根文件系统 `statfs`，在 Vercel 上不代表实际服务器容量。
- `StorageService`
  - 使用常驻定时器清理过期 PendingUpload。
- `apps/api/src/modules/settings/https-agent.client.ts`
  - 依赖 `/run/liveboard/https-agent.sock` Unix Socket。
- 这些能力需要按 `DEPLOYMENT_TARGET` 分支，不能在 Vercel 冷启动时启用。

### 1.8 当前生产部署

- `docker-compose.yml` 运行 PostgreSQL、Redis、MinIO、migrate、API 和 Web。
- 正式自托管使用 GitHub Release `.run` 包、Nginx 和宿主机助手。
- `README.md`、`docs/deploy-ubuntu-24.04.md` 当前以自托管为唯一正式生产路径。
- 本次改造要把文档调整为两个受支持目标，但不得删除或弱化现有自托管发布链路。

## 2. 目标架构与数据流

### 2.1 Vercel 项目拓扑

创建两个 Vercel Project：

1. `liveboard-api`
   - Git 仓库：个人账号下的 LiveBoard 私有镜像。
   - Root Directory：`apps/api`。
   - Framework：NestJS。
   - Node.js：22。
   - Function Region：`sin1`。
2. `liveboard-web`
   - 同一个人镜像仓库。
   - Root Directory：`apps/web`。
   - Framework：Next.js。
   - Node.js：22。

两个 Project 都开启 “Include source files outside of the Root Directory”，以便安装 workspace 依赖并构建 `packages/shared`。

创建 API Project 后取得真实 `prj_*` ID，将其写入 `apps/web/vercel.json` 的 `relatedProjects`。不得提交虚假 Project ID 占位符。

### 2.2 浏览器/API 数据流

```text
浏览器
  → https://站点域名/api/*
  → liveboard-web 的 Vercel rewrite
  → 同一 Git 提交对应的 liveboard-api Deployment
  → PostgreSQL / Redis / R2
```

- Web 在 Production 和 Preview 中均设置 `NEXT_PUBLIC_API_URL=/api`。
- `@vercel/related-projects` 在构建时解析对应环境的 API Host。
- `API_HOST` 只作为 Related Projects 信息缺失或本地构建时的稳定后备地址。
- 浏览器不直接访问 API Project 域名，Session Cookie 保持在 Web 域名下。
- API 的 CORS 只为明确配置的直接访问来源返回跨域头；同源 rewrite 请求不依赖 CORS。

### 2.3 R2 直传数据流

```text
浏览器 → API 请求上传签名
API → 校验会话、权限、名称、同名、数量、容量和配额
API → 创建 PendingUpload
API → 返回 60 秒有效的 R2 预签名 PUT
浏览器 → 直接 PUT 原始文件到 R2
浏览器 → API 确认上传
API → HEAD/Stat 校验对象
API → 创建或更新业务记录并删除 PendingUpload
```

适用入口：

- 独立文件：强制直传。
- 课堂文件：强制直传。
- 论坛图片：新增直传流程。
- Banner：新增直传流程。
- 头像、favicon、Markdown 导入仍可经过 API，因为均低于 Vercel 4.5 MB 上限；最终对象仍写入 R2。

Vercel 环境下，必须禁止大文件上传从直传静默回退到 API relay。

### 2.4 文件读取数据流

#### 附件下载

```text
浏览器 → API 下载请求
API → 校验当前权限
API → 302 到短期 R2 预签名 GET
浏览器 → 直接从 R2 下载
```

#### Inline 资源和预览

```text
浏览器 → API 预览/图片请求
API → 校验当前权限
API → 从 R2 获取 Readable Stream
API → 流式 pipe 给浏览器
```

- PDF、Markdown、TXT 预览仍需 API 重新校验当前访问权限。
- 头像、Banner、论坛图片、favicon 继续由 API 中转。
- PDF 和大图片禁止完整读取成 Buffer 后再发送。
- 文本预览可在 2 MB 上限内缓冲。
- R2 Bucket 始终保持 Private，不启用公开 `r2.dev` 地址。

### 2.5 托管 PostgreSQL 和 Redis

- PostgreSQL 推荐 Neon Singapore。
  - `DATABASE_URL`：运行时池化地址。
  - `DIRECT_DATABASE_URL`：Prisma migration 直连地址。
- Redis 推荐 Upstash Singapore。
  - 使用标准 TLS `rediss://` 地址。
  - 保留当前 Lua/原子限流语义。
- Provider 不是代码强绑定；只要提供兼容 PostgreSQL 和 Redis 协议的连接地址即可。

### 2.6 Preview/Production 隔离

以下资源不得共用：

- PostgreSQL 数据库或数据库分支。
- Redis 数据库。
- R2 Bucket。
- `SESSION_SECRET`。
- `AI_ENCRYPTION_KEY`。
- `CRON_SECRET`。
- 首次管理员账号。

Preview Bucket 的 CORS 可以允许所有 Origin，但只能开放 `PUT`，且 Bucket 仍为私有；Production Bucket 必须只允许正式 Web Origin。

## 3. 需要新增和修改的文件

### 3.1 新增文件

- `apps/api/vercel.json`
  - NestJS、Node 22、`sin1`、函数时限和每日 Cron。
- `apps/web/vercel.json`
  - Next.js 项目配置和 API Project 的真实 Related Project ID。
- `apps/api/src/common/deployment-target.ts`
  - 解析 `DEPLOYMENT_TARGET=self_hosted|vercel`。
- `apps/api/src/modules/storage/r2-storage.backend.ts`
  - AWS S3 SDK 方式实现 R2。
- `apps/api/src/modules/storage/storage-cron.controller.ts`
  - 每日过期上传清理入口。
- `apps/api/src/modules/redis/redis.module.ts`
- `apps/api/src/modules/redis/redis.service.ts`
  - 全局共享、惰性初始化的 Redis 连接。
- `apps/api/prisma/migrations/00000000000000_baseline_v1/migration.sql`
  - 在所有 Vercel/R2 schema 修改完成后，从最终 schema 生成的唯一基线。
- `apps/api/scripts/migrate-storage-to-r2.ts`
  - 可恢复、可重复执行的 MinIO/OSS → R2 对象迁移工具。
- `apps/api/scripts/verify-vercel-data-migration.ts`
  - 校验业务表行数、外键、最高管理员、对象清单和 backend 状态。
- `scripts/legacy-baseline-transition.sh`
- `scripts/legacy-baseline-transition.spec.sh`
  - 让已应用旧 41 个 migration 的自托管数据库安全过渡到新 baseline 历史，避免发布升级直接执行 baseline 建表 SQL。
- `docs/migrate-data-to-vercel-r2.md`
  - 数据库备份、恢复、离线 schema 升级、对象迁移、baseline、验收和回滚手册。
- `docs/deploy-vercel-r2.md`
  - Vercel Hobby、个人 Git 镜像、Neon、Upstash、R2 和数据迁移后部署教程。
- `deploy/vercel/r2-cors-production.example.json`
- `deploy/vercel/r2-cors-preview.json`
- 上述模块对应的 Jest/Vitest 测试文件。

### 3.2 修改文件

- 根目录 `package.json` 和 `pnpm-lock.yaml`。
- `apps/api/package.json`
  - 新增 `@aws-sdk/client-s3`、`@aws-sdk/s3-request-presigner`。
  - 增加 baseline、数据迁移、对象迁移和校验脚本入口。
- `apps/web/package.json`
  - 新增 `@vercel/related-projects`。
- `apps/web/next.config.mjs`
  - Related Projects 解析和 `/api` rewrite。
- `apps/web/lib/api/client.ts`
  - 通用 POST Form/PUT 直传器。
- `apps/web/lib/api/index.ts`
  - `r2` 类型、上传指令联合类型、新接口。
- `apps/web/app/app/forum/ForumImagePicker.tsx`
- `apps/web/app/app/profile/ProfileClient.tsx`
- `apps/web/app/app/admin/storage-backend/StorageBackendClient.tsx`
- `apps/web/app/app/admin/server-status/ServerStatusClient.tsx`
- `apps/web/app/app/admin/settings/SystemSettingsClient.tsx`
- `apps/api/src/main.ts`
- `apps/api/src/app.module.ts`
- `apps/api/src/modules/storage/storage-backend.ts`
- `apps/api/src/modules/storage/storage.module.ts`
- `apps/api/src/modules/storage/storage.service.ts`
- `apps/api/src/modules/files/files.controller.ts`
- `apps/api/src/modules/files/files.dto.ts`
- `apps/api/src/modules/files/assets.service.ts`
- `apps/api/src/modules/classrooms/classrooms.controller.ts`
- `apps/api/src/modules/classrooms/classrooms.dto.ts`
- `apps/api/src/modules/classrooms/classrooms.service.ts`
- `apps/api/src/modules/forum/forum.controller.ts`
- `apps/api/src/modules/forum/forum.dto.ts`
- `apps/api/src/modules/forum/forum.service.ts`
- `apps/api/src/modules/auth/auth.controller.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/health/health.service.ts`
- `apps/api/src/modules/server-status/server-status.service.ts`
- `apps/api/src/modules/settings/settings.service.ts`
- `apps/api/src/modules/settings/https-agent.client.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/prisma/prisma.service.ts`
- `apps/api/prisma/schema.prisma`
- `.env.example`
- `.env.production.example`
- `README.md`
- `AGENTS.md`
- `.github/workflows/ci.yml`

### 3.3 必须保留的文件和行为

- 不删除 `docker-compose.yml`。
- 不删除 MinIO/OSS Backend。
- 不删除 Nginx、HTTPS Agent 或 Release `.run` 脚本。
- `DEPLOYMENT_TARGET` 未配置时默认 `self_hosted`。
- 本地 `pnpm infra:up && pnpm dev` 继续使用 PostgreSQL、Redis、MinIO。
- 旧数据库、MinIO/OSS 和原自托管部署在迁移验收完成前保持不动；对象复制到 R2 后也不立即删除源对象。
- 旧 41 个 migration 可以从主分支移除，但必须先由 Git tag/历史完整保留。

## 4. 具体实现改动

### 4.1 部署目标配置

新增统一配置函数：

```ts
type DeploymentTarget = "self_hosted" | "vercel";
```

规则：

- `DEPLOYMENT_TARGET` 缺失时返回 `self_hosted`。
- 值不合法时启动失败。
- 不允许业务模块各自读取 `VERCEL` 环境变量决定行为。
- `VERCEL` 只能作为诊断信息，明确行为以 `DEPLOYMENT_TARGET` 为准。

### 4.2 Vercel 环境变量

API Project 至少配置：

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
AI_ENCRYPTION_KEY=<stable random key>
SESSION_COOKIE_SECURE=true
TRUST_PROXY_HOPS=1
WEB_ORIGIN=https://<production web domain>
CRON_SECRET=<random secret at least 32 bytes>
NODE_ENV=production
```

Web Project：

```text
NEXT_PUBLIC_API_URL=/api
API_HOST=https://<stable production api host>
NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS=false
```

Preview 和 Production 分别设置不同值。

### 4.3 Vercel 构建

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

Web 构建顺序：

```bash
pnpm --filter @liveboard/shared build
pnpm --filter @liveboard/web build
```

注意：

- Preview 必须使用独立数据库，否则 Preview 构建会对生产库执行 migration。
- Migration 必须采用 expand/contract 兼容方式，避免 schema 已升级但新 Deployment 尚未接管流量时破坏旧代码。
- 首次管理员初始化不能放在 build 或冷启动中。

### 4.4 Web/API 同源路由

`apps/web/next.config.mjs`：

1. 使用 `withRelatedProject` 获取 `liveboard-api` Host。
2. 缺失时回退 `API_HOST`。
3. 把 `/api/:path*` rewrite 到 `https://<api-host>/:path*`。
4. 本地开发仍使用 `NEXT_PUBLIC_API_URL=http://localhost:4000`，不走 Vercel rewrite。

`apps/web/vercel.json`：

- `relatedProjects` 必须填写创建 API Project 后取得的真实 `prj_*` ID。
- Related Projects 只用于个人镜像仓库的 Git Deployment。

### 4.5 API CORS、Cookie 和代理

- Vercel 强制 Secure Cookie。
- Cookie 不设置 `Domain`，只属于 Web Host。
- 保持 HttpOnly、SameSite=Lax。
- `TRUST_PROXY_HOPS=1`，不得无限信任用户提交的转发头。
- CORS 对明确的 `WEB_ORIGIN` 返回凭据式响应。
- Preview 通过 Web 同源 rewrite 访问，不要求把任意 `*.vercel.app` 配置为凭据式 CORS Origin。
- 任何新增写接口继续经过当前会话和活动用户守卫。

### 4.6 R2 Backend

新增 `R2StorageBackend`，使用：

- `@aws-sdk/client-s3`
- `@aws-sdk/s3-request-presigner`

固定规则：

- `region: "auto"`。
- Endpoint 由 `R2_ACCOUNT_ID` 计算：`https://<account-id>.r2.cloudflarestorage.com`。
- Bucket 来自 `R2_BUCKET`。
- 不允许管理员填写任意 Endpoint。
- Bucket 保持 Private。
- 不配置 ACL 或 public-read。

实现接口：

- `putObject`
- `getObject`
- `removeObject`
- `statObject`
- `healthCheck`
- `presignGet`
- `presignPut`

预签名 PUT：

- 有效期固定 60 秒。
- 签入 `Content-Type`。
- 使用不可预测 UUID Key。
- 不把 Secret 返回前端。
- 不把完整预签名 URL写入日志。

### 4.7 StorageService

- 删除构造函数中无条件初始化 MinIO 的行为。
- 后端按第一次实际使用惰性初始化并缓存于当前函数实例。
- `backendFor("minio" | "oss" | "r2")` 均可读取历史对象。
- Vercel 下：
  - active backend 固定为 `r2`。
  - `downloadMode` 固定为 `direct`，但 inline 资源继续 API 中转。
  - `uploadMode` 固定为 `direct`。
  - 忽略数据库中的 active backend 选择。
  - 缺失任何 R2 环境变量时启动失败，并列出缺失变量名。
- Self-hosted 下保留现有数据库设置、MinIO 和阿里云 OSS 行为。
- Vercel 管理 API：
  - GET 返回只读有效配置和健康状态。
  - PUT/test 返回 409，说明由环境变量管理。

### 4.8 上传 API 联合类型

前后端统一定义：

```ts
type ObjectUploadInstruction =
  | {
      transport: "form_post";
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      transport: "put";
      url: string;
      headers: Record<string, string>;
      expiresAt: string;
    };
```

签名响应：

```ts
type SignedUploadResponse = {
  uploadId: string;
  instruction: ObjectUploadInstruction;
  expiresAt: string;
};
```

- OSS 使用 `form_post`。
- R2 使用 `put`。
- 前端不得通过是否存在 `fields` 猜测协议，必须使用 `transport` 判别。

### 4.9 前端上传器

把 `postToObjectStorageWithProgress` 扩展或重命名为通用上传器：

- `form_post`：保留当前 FormData POST。
- `put`：XHR PUT 原始 `File`。
- PUT 请求只设置服务端返回的允许 Header。
- 保留真实上传进度。
- 保留 AbortController/取消。
- 保留 `MAX_CONCURRENT_UPLOADS = 2`。
- 每个文件独立显示等待、上传、失败、取消和完成。
- 非法名或同名文件不能阻断同批次有效文件。

Vercel 下直传失败必须直接失败，不允许转为 `/upload` multipart。

### 4.10 文件和课堂文件

保留现有接口：

- `POST /assets/upload-url`
- `POST /assets/upload-confirm`
- `POST /assets/upload-abort`
- `POST /classrooms/:id/files/upload-url`
- `POST /classrooms/:id/files/upload-confirm`
- `POST /classrooms/:id/files/upload-abort`

签名前继续执行：

- 登录和资源权限。
- 资源名称规范化与非法名检测。
- 当前目录/课堂同名检测。
- 文件大小上限。
- 用户和课堂容量配额。
- 未完成上传数量限制。

Confirm 时：

- 根据 PendingUpload 中保存的 `storageBackend` 查找对象。
- 校验对象存在。
- 精确校验 `sizeBytes`。
- 对象不匹配时删除对象和 PendingUpload。
- 业务记录创建成功后再删除 PendingUpload。
- 数据库写入对应对象的 `storageBackend=r2`。

### 4.11 论坛图片直传

新增：

- `POST /forum/posts/:id/images/upload-url`
- `POST /forum/posts/:id/images/upload-confirm`
- `POST /forum/posts/:id/images/upload-abort`

签名前：

- 帖子必须存在。
- 当前用户必须具备为该帖子添加图片的权限。
- 重新计算帖子当前图片数和本次预留数。
- 主帖最多 9 张，评论/嵌套回复最多 3 张。
- 单张不超过 10 MB。
- MIME 必须是允许的图片类型。

Confirm 时：

- 从 R2 读取对象并验证真实文件头。
- 校验 WebP/PNG/JPEG/GIF 等允许格式和尺寸限制。
- 验证失败时删除对象。
- 创建 `FileAsset` 并关联 `ForumPost`。
- 匿名内容的响应不得暴露上传者或原始文件名。

前端仍在上传前压缩为最长边不超过 1600px 的 WebP，但不能以客户端压缩替代服务端校验。

### 4.12 Banner 直传

新增：

- `POST /auth/me/banner/upload-url`
- `POST /auth/me/banner/upload-confirm`
- `POST /auth/me/banner/upload-abort`

Confirm 时：

- 验证对象大小、真实文件头和图片尺寸。
- 数据库事务更新用户 Banner Key、MIME、更新时间、`storageBackend=r2`。
- 更新成功后尽力删除旧 Banner。
- 若旧对象删除失败，不回滚新 Banner，但记录不含 Secret 的错误日志。

头像和 favicon 继续走现有 multipart，但 `StorageService.putObject()` 在 Vercel 下写入 R2。

### 4.13 PendingUpload 数据模型

Prisma 修改：

```prisma
enum StorageBackend {
  minio
  oss
  r2
}

enum PendingUploadKind {
  asset
  classroom
  forum_image
  profile_banner
}
```

`PendingUpload` 新增：

- `storageBackend StorageBackend`
- `forumPostId String?`
- 到 `ForumPost` 的可空关系。
- `forumPostId` 索引。

基线规则：

- 这些字段直接进入最终 `schema.prisma` 和唯一 baseline，不在最终仓库保留单独的 R2 增量 migration。
- 数据迁移时不复制旧 `PendingUpload` 行；它们是短期技术状态，不属于业务数据。
- `storageBackend` 保留 `@default(minio)`，使从旧数据库恢复的数据和本地自托管保持兼容。
- 新 Vercel 上传在创建 PendingUpload 时显式写入 `storageBackend=r2`。

数据库中不新增以下字段：

- R2 Secret。
- R2 Access Key ID。
- R2 Account ID。
- R2 Endpoint。

这些值只存在 Vercel Environment Variables。

### 4.14 过期上传清理

Self-hosted：

- 保留现有进程内周期清理。

Vercel：

- 禁用 `setInterval`。
- 新增 `GET /internal/cron/storage-cleanup`。
- 使用 `Authorization: Bearer ${CRON_SECRET}`。
- Secret 使用恒定时间比较。
- 未授权返回 401，不返回清理信息。
- 使用 Redis 分布式锁防止重复执行。
- 清理逻辑幂等。
- `vercel.json` 使用每天一次的 UTC Cron；不得配置小时级表达式。
- 用户申请新上传签名时，继续执行当前用户范围内的惰性清理。
- R2 临时 Key 使用 `pending/` 前缀，并配置一天后的 Bucket Lifecycle 删除规则。

### 4.15 Redis

新增全局 `RedisModule/RedisService`：

- 连接惰性创建。
- 同一函数实例复用同一个客户端。
- 支持 `rediss://`。
- 断线时有限重连，避免无限阻塞请求。
- Login Limiter、AI Limiter、AI Concurrency、Health 共用该服务。

故障规则：

- 本地开发/测试允许内存 fallback。
- Vercel 和其他生产环境禁止 fallback。
- Redis 不可用时登录和 AI 请求返回 503。
- 普通已登录业务请求仍可依靠数据库 Session Guard 运行。

### 4.16 Server Status

返回判别联合：

```ts
type ServerStatus =
  | {
      mode: "host";
      current: HostMetrics;
      history: HostMetrics[];
    }
  | {
      mode: "serverless";
      region: string | null;
      deploymentId: string | null;
      dependencies: {
        postgres: HealthState;
        redis: HealthState;
        r2: HealthState;
      };
    };
```

Vercel 下：

- 不启动采样定时器。
- 不写 `ServerMetricSample`。
- 不展示 Vercel 临时实例的 CPU、磁盘和内存为服务器容量。

Self-hosted 下保留现有指标和历史表。

### 4.17 HTTPS 管理

- Vercel 下不实例化 Unix Socket Client。
- `GET /admin/settings/https` 返回：

```ts
{
  available: false,
  managedBy: "vercel",
  message: "域名与 HTTPS 由 Vercel 项目设置管理"
}
```

- 启用、续期和修改 HTTPS 的写接口在 Vercel 下返回 409。
- Self-hosted HTTPS Agent 行为保持不变。

### 4.18 AI 流式请求

- 保留 NDJSON Streaming 和浏览器断开取消上游请求。
- API Function 可保留 `maxDuration=300`，但不能把它当作浏览器链路可用时长。
- 因 Web→API rewrite 上限为 120 秒，AI 上游 `AbortSignal.timeout` 从 120 秒改为 110 秒。
- 其余 30 秒检索/辅助调用超时保持不变。
- 前端必须正确显示上游超时，不把截断回答当作完整成功。
- 设计上不支持单次回答超过约 110 秒；如未来需要长任务，应升级 Pro 并重新设计异步任务/持久流协议。

### 4.19 PDF 和大资源响应

- 附件下载优先 302 到 R2。
- PDF 预览、论坛图片、Banner 等必须直接 pipe Readable Stream。
- 禁止 `await streamToBuffer()` 后 `response.send(buffer)` 发送可能超过 4.5 MB 的内容。
- 权限检查必须在创建 R2 Readable Stream 前完成。
- 客户端断开时销毁 R2 Stream。
- 保留 `nosniff`、CORP 和现有 Cache-Control 策略。
- 对非常慢的 25 MB PDF 预览，仍可能受 Vercel 120 秒代理限制；下载必须提供独立 R2 直出作为兜底。

### 4.20 Storage 管理界面

API 的只读存储状态增加：

```ts
{
  backend: "r2",
  source: "environment",
  editable: false,
  bucket: string,
  healthy: boolean,
  uploadMode: "direct",
  downloadMode: "direct"
}
```

Web：

- 显示“Cloudflare R2，由 Vercel 环境变量管理”。
- 显示 Bucket、连接状态、直传/下载状态。
- 不显示 Access Key 或 Secret。
- 不允许切换 MinIO/OSS。
- 显示 R2 CORS 和环境变量配置入口说明。
- Self-hosted 下保留现有服务器存储/阿里云 OSS 设置界面。

### 4.21 管理员与加密数据迁移

- 不在 Vercel Build、冷启动、Health Check 或 Cron 中创建管理员。
- 正式环境会恢复现有 User 数据，因此不得运行 `apps/api/src/bootstrap-production.ts`，也不得运行 `apps/api/prisma/seed.cjs`。
- 切换前必须验证至少存在一名 `status=active` 且 `role=super_admin` 的用户。
- 用户密码哈希直接随数据库迁移，用户无需重设密码。
- Production 必须沿用旧环境的 `AI_ENCRYPTION_KEY`，否则迁移过来的 AI Provider API Key 无法解密。
- `SESSION_SECRET` 可以更换；更换会使旧 Session 失效，用户重新登录即可。
- 如果未来决定轮换 `AI_ENCRYPTION_KEY`，必须单独实现“旧 Key 解密、新 Key 重新加密”的受控脚本，不能直接替换环境变量。

## 5. 数据迁移与 migration 基线重建

### 5.1 总体策略

采用“新数据库恢复 + 离线升级 + 对象复制 + baseline 标记”，不修改旧生产数据库的 migration 历史：

```text
旧 PostgreSQL（只读保留）
  → 完整 pg_dump，但排除旧 migration 和临时技术数据
  → 恢复到新的目标 PostgreSQL
  → 离线升级到最终 Vercel/R2 schema
  → 复制 MinIO/OSS 对象到 R2 并逐行切换 backend
  → 标记唯一 baseline 已应用
  → Vercel 接管流量
```

禁止在旧生产数据库上删除 `_prisma_migrations`、运行 `migrate reset` 或运行 `db push`。旧数据库、旧应用和旧对象存储在最终验收前保持可回滚。

### 5.2 前置条件和冻结点

1. 先完成本文全部 Vercel/R2 代码和最终 `schema.prisma`。
2. 运行 `pnpm validate`，确认 schema 不再变化。
3. 检查源数据库当前 migration 全部已应用，并确认没有未记录的 schema drift。
4. 在移除旧 migration 前创建可恢复的 Git tag，例如 `pre-vercel-baseline`；不得重写 Git 历史。
5. 做一次不影响生产的完整演练，记录备份、恢复、对象复制和验证耗时。
6. 正式切换时进入维护模式，停止一切数据库和对象存储写入，再生成最终快照。

### 5.3 PostgreSQL 备份与恢复

使用 PostgreSQL custom-format 完整备份和 `pg_restore`，让表、数据、约束和 Prisma schema 无法表达的数据库结构一起进入新数据库。

备份必须排除以下表的数据，但保留表结构：

- `_prisma_migrations`：不能把旧 41 条 migration 历史带入目标库。
- `PendingUpload`：短期上传预留，不属于业务数据。
- `ServerMetricSample`：旧宿主机运行指标对 Vercel 无意义。

恢复要求：

- 恢复到一个全新、空的目标 PostgreSQL/Neon 数据库。
- 使用 `--no-owner`、`--no-privileges`、`--exit-on-error` 和单事务能力。
- 任何恢复错误立即终止，不允许忽略错误后继续部署。
- 源数据库保持不变。

### 5.4 离线升级到最终 schema

完整 dump 恢复后，目标数据库仍是旧应用的最终结构。使用 `prisma migrate diff` 比较：

- `--from-url`：新恢复数据库。
- `--to-schema-datamodel`：最终 `apps/api/prisma/schema.prisma`。

生成差异 SQL后必须人工审查，再通过 `prisma db execute` 对目标数据库执行。该 SQL只用于一次性数据搬迁，不进入最终 migration 历史。

升级完成后再次执行 diff，结果必须为空。任何 rename/drop/required-column 操作都必须有明确数据处理，不允许依赖 Prisma 推断自动丢弃数据。

### 5.5 生成唯一 baseline

从最终 `schema.prisma` 生成一个“空数据库 → 最终结构”的基线：

```bash
pnpm --filter @liveboard/api exec prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script
```

输出保存到：

```text
apps/api/prisma/migrations/00000000000000_baseline_v1/migration.sql
```

最终 migrations 目录只保留：

```text
apps/api/prisma/migrations/
├── 00000000000000_baseline_v1/
│   └── migration.sql
└── migration_lock.toml
```

现有 migration 中至少有一项 Prisma schema 无法表达的手写结构，必须补回 baseline：

```sql
CONSTRAINT "ForumPostVote_value_check"
CHECK ("value" IN (-1, 1))
```

同时审计全部旧 migration 中的 CHECK、Trigger、View、Function、Partial Index、Extension 和其他手写结构 SQL。历史 `INSERT`/`UPDATE` 数据转换不复制到 baseline，因为恢复的业务数据已经处于最终状态。

### 5.6 标记目标数据库的 baseline

目标数据库已经通过 dump 恢复和离线 schema 升级获得最终结构，因此不能再次执行 baseline 建表 SQL。对目标数据库运行：

```bash
prisma migrate resolve --applied 00000000000000_baseline_v1
```

完成后必须验证：

- `_prisma_migrations` 只有一条成功的 baseline 记录。
- `prisma migrate status` 无 pending migration。
- 数据库实际结构与最终 `schema.prisma` 无 drift。
- 在另一个全新测试数据库执行 `prisma migrate deploy`，单个 baseline 能从零创建完整 schema。

Vercel Build 仍执行 `prisma migrate deploy`；正式目标库会跳过已标记的 baseline，未来只应用 baseline 之后的新 migration。

### 5.7 现有自托管数据库的历史过渡

仓库改为单 baseline 后，既有自托管数据库仍保存旧 41 条 `_prisma_migrations` 记录。不能直接让普通 `prisma migrate deploy` 对这些数据库运行，否则 baseline 会被视为未应用并尝试重复建表。

新增受控过渡脚本，并由 Release 安装器在数据库备份后、正常 `migrate deploy` 前调用：

1. 只读检查 `_prisma_migrations`，确认它精确匹配已知的旧 LiveBoard 历史，且所有记录成功完成。
2. 检查实际 schema 与旧版本期望状态一致；存在未知 migration、失败记录或 drift 时立即停止，禁止自动 resolve。
3. 执行经过审查的“旧最终 schema → 新最终 schema”桥接 SQL；该 SQL不放回 Prisma migration 目录。
4. 验证目标 schema 与最终 `schema.prisma` 一致。
5. 运行 `prisma migrate resolve --applied 00000000000000_baseline_v1`。
6. 再运行正常 `prisma migrate deploy`，确认无 pending。

既有自托管数据库可以保留旧 41 条审计记录并新增 baseline 标记；“只有一条 baseline”的要求只适用于新 Vercel/新安装数据库。仓库仍只保留一个 baseline，因此不会继续携带 41 个旧 SQL 文件。

过渡脚本要求：

- 执行前必须有数据库备份。
- 默认只检查和输出计划，显式参数才执行。
- 精确校验已知 migration 名称和 checksum，不接受“只看数量”。
- 不清空或改写既有 `_prisma_migrations` 行。
- 任何未知状态 fail closed，并提示使用旧版本或人工处理。
- 对应 shell 回归测试必须覆盖正常过渡、未知历史、失败 migration、schema drift、重复执行和数据库不可达。

### 5.8 对象迁移工具

`apps/api/scripts/migrate-storage-to-r2.ts` 必须覆盖所有存储引用：

- `User.avatarStorageKey`
- `User.bannerStorageKey`
- Workspace 默认/亮色/暗色 favicon
- `FileAsset.storageKey`
- `ClassroomFile.storageKey`

每个对象按以下事务边界处理：

1. 根据当前记录的 `storageBackend` 从 MinIO 或 OSS 获取源对象。
2. 使用相同 `storageKey` 流式写入 R2，禁止完整载入内存。
3. 对 R2 执行 stat，校验对象存在和大小一致；可用时同时校验内容哈希。
4. 只有校验成功后，才把该数据库记录的 `storageBackend` 更新为 `r2`。
5. 单个对象失败记录错误并继续；不得批量提前把全部 backend 改为 R2。

工具要求：

- `--dry-run` 默认开启，只有显式参数才执行写入。
- 支持按对象类型、ID 范围或批次运行。
- 可中断、可恢复、可重复执行；已验证完成的 R2 对象自动跳过。
- 限制并发，避免压垮旧 MinIO/OSS、R2 或数据库。
- 输出总记录数、已迁移数、已跳过数、失败数、缺失对象数和总字节数。
- 日志不得包含存储 Secret、签名 URL 或用户隐私内容。
- 数据量较大时先在旧系统仍运行期间预复制，再在维护窗口复制增量；数据量较小时可在维护窗口一次完成。

### 5.9 StorageSettings 和密钥清理

所有对象验证完成后：

- 清空目标数据库 `StorageSettings` 中遗留的 OSS Access Key、加密 Secret、Endpoint、Internal Endpoint 和相关标志。
- 把有效 backend/mode 调整为 R2/direct，实际 R2 凭据仍只来自 Vercel 环境变量。
- Production 沿用旧 `AI_ENCRYPTION_KEY`，确保迁移的 AI Provider API Key 可解密。
- `SESSION_SECRET` 可以重新生成；接受所有旧 Session 失效。
- 不运行 production bootstrap；使用迁移过来的最高管理员。

### 5.10 迁移验证

`apps/api/scripts/verify-vercel-data-migration.ts` 至少验证：

- 所有业务表源/目标行数一致；明确排除技术表。
- 不存在孤立外键。
- 至少存在一名正常的最高管理员。
- 文档、文件夹、课堂、练习、提交、论坛、通知和 AI 会话的关键关联完整。
- AI Provider 配置能使用 Production `AI_ENCRYPTION_KEY` 解密。
- 所有非空存储引用在 R2 中存在并且大小符合数据库记录。
- 所有已迁移对象记录的 backend 为 `r2`。
- R2 缺失对象数为 0；否则生成阻断上线的明确清单。
- `_prisma_migrations` 只有唯一 baseline。

另外进行浏览器抽样：头像、Banner、favicon、论坛图片、PDF、Markdown/TXT、文档附件和课堂文件均能预览或下载。

### 5.11 正式切换与回滚

正式切换顺序：

1. 旧系统进入维护模式并停止写入。
2. 生成最终 PostgreSQL dump。
3. 恢复到新的正式目标数据库。
4. 离线升级最终 schema。
5. 完成 R2 对象迁移和 StorageSettings 清理。
6. 标记唯一 baseline。
7. 运行完整数据、对象和应用验证。
8. 把 Vercel Production 环境变量指向新数据库、Redis 和 R2。
9. 部署并验证 Vercel Production。
10. 验收后恢复用户访问。

回滚规则：

- 旧数据库、旧 MinIO/OSS 和旧自托管版本保持只读且不删除。
- Vercel 验证失败时停止 Vercel 流量，恢复旧自托管入口。
- 不把 Vercel 产生的新写入反向合并到旧系统；因此正式开放流量前必须完成验收。
- 旧环境的最终删除是独立的后续任务，不属于本次切换。

## 6. Cloudflare R2 配置

### 6.1 Bucket

至少创建：

- `liveboard-production`
- `liveboard-preview`

两者均：

- Private。
- 禁用公共 `r2.dev`。
- 不启用公开自定义域名。
- 使用各自独立的 Bucket-scoped Object Read/Write Token。

### 6.2 Production CORS

只允许正式 Web Origin：

```json
[
  {
    "AllowedOrigins": ["https://liveboard.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

部署时必须替换为真实 Origin，不能包含路径或结尾 `/`。

### 6.3 Preview CORS

Preview 使用独立 Bucket，可以使用：

```json
[
  {
    "AllowedOrigins": ["*"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

允许任意 Origin 只适用于 Preview Bucket。安全边界仍由以下条件提供：

- Bucket 私有。
- 没有预签名 URL 无法写入。
- URL 仅 60 秒有效。
- 随机 Key。
- Confirm 校验。
- Preview 与 Production 完全隔离。

### 6.4 Lifecycle

- 临时上传对象统一以 `pending/` 开头。
- 配置 R2 Lifecycle 删除一天以上的 `pending/` 对象。
- 正式业务对象不能位于 `pending/` 前缀。

## 7. 兼容性、边界情况和安全风险

### 7.1 Vercel Hobby 使用资格

- Hobby 只用于个人、非商业用途。
- 正式学校/企业/收费场景必须升级 Pro 或自托管。
- Hobby 不能连接当前 GitHub Organization 仓库，必须使用个人镜像。

### 7.2 Hobby 用量

实施时以 Vercel 当前 Dashboard 和官方文档为准；当前主要额度包括：

- 100 GB/月 Fast Data Transfer。
- 最多约 10 GB/月 Fast Origin Transfer。
- 100 万次/月 Function Invocation。
- 4 小时/月 Active CPU。
- 360 GB-hours/月 Provisioned Memory。
- 一个并发构建。
- Runtime Logs 保留时间很短。

Hobby 不能购买超额用量；达到限制后项目可能被暂停。因此：

- R2 大文件必须直传、直下载。
- 管理员定期查看 Vercel Usage。
- 不把 Vercel Runtime Logs 当作长期审计日志。
- 正式课堂投入前必须做预计用户数和月流量测算。

### 7.3 请求体和响应体

- Vercel Function 普通请求/响应体上限 4.5 MB。
- 文件、课堂文件、论坛图片和 Banner 必须直传。
- PDF/图片 API 中转必须流式发送。
- 不得通过提高 Nest/Multer 限制解决 Vercel 平台限制。

### 7.4 预签名 PUT 风险

PUT 不具备 OSS POST Policy 的全部大小约束能力。缓解措施：

- 60 秒有效期。
- 随机 Key。
- Content-Type 签名。
- 每用户最多 20 个未完成上传。
- Redis 限制签名频率。
- Confirm 精确校验大小。
- 失败和过期删除对象。
- R2 Lifecycle 最终兜底。

剩余风险：拿到 URL 的客户端可以在有效期内重复覆盖同一临时 Key。首版接受该风险，不额外引入 Cloudflare Worker。

### 7.5 权限与私有资源

- R2 签名 GET 只用于明确附件下载。
- Inline 图片、头像、Banner、favicon、PDF/Markdown/TXT 继续 API 中转。
- 每次读取都重新验证当前用户权限。
- 归档、删除或权限变化后不能继续通过旧业务 URL访问对象。
- 预签名 URL 不得进入业务数据库、通知正文或日志。

### 7.6 Secret

- R2 Secret、数据库地址、Redis 地址、Session Secret、AI Encryption Key 只存在 Vercel Secret Environment Variables。
- 禁止 `NEXT_PUBLIC_*`。
- 禁止存入 `StorageSettings`。
- 禁止 API 返回。
- 禁止写入构建日志、Runtime Log 或异常上下文。
- R2 Token 只授权对应 Bucket 的 Object Read/Write。

### 7.7 数据库连接

- Runtime 必须使用连接池地址。
- Migration 使用 `DIRECT_DATABASE_URL`。
- 不允许每个请求创建 PrismaClient。
- 保持 Nest provider 单例并在实例复用期间复用连接。
- Preview 不得对 Production 数据库运行 migration。

### 7.8 Redis 故障

- 登录和 AI 限流在生产环境 fail closed。
- 禁止跨 Serverless 实例使用内存计数作为安全边界。
- Redis Health 失败导致整体 `/health` 返回非健康，但非 AI 的已登录业务接口可以按现有数据库鉴权继续工作。

### 7.9 数据和对象迁移风险

- 不允许只恢复数据库而不复制对象；否则数据库中的文件引用会指向 Vercel 无法访问的 MinIO/OSS。
- 不允许提前批量把 backend 改为 R2；必须逐对象复制、校验、再更新记录。
- 不恢复旧 `_prisma_migrations` 数据，也不在旧生产库中清空 migration 历史。
- 仓库切换到单 baseline 后，既有自托管数据库必须先经过受控历史过渡，不能直接运行普通 `migrate deploy`。
- 不迁移 `PendingUpload` 和 `ServerMetricSample` 数据；二者分别是短期上传状态和旧宿主机指标。
- 目标数据库恢复和离线升级必须至少演练一次；正式切换前记录预计停机时间。
- 迁移的 AI 配置要求 Production 沿用旧 `AI_ENCRYPTION_KEY`；丢失旧 Key 时不能假设密文可恢复。
- 对象迁移完成后仍保留旧存储作为回滚来源，不在本任务中删除。
- 如果未来把目标数据库接回自托管环境，仍需提供 R2 环境变量才能读取已经迁移的对象。

### 7.10 Vercel 文件系统和后台任务

- 不保存上传文件到本地文件系统。
- 不依赖实例内缓存长期存在。
- 不使用 `setInterval` 承担关键清理。
- Cron 可能延迟、失败或重复调用，清理必须幂等并有 R2 Lifecycle 兜底。

## 8. 测试和验证

### 8.1 单元测试

#### R2 Backend

- 正确构造 endpoint、region 和 bucket。
- PUT、GET、HEAD、DELETE 命令。
- AWS SDK Readable Stream 转换。
- 预签名 PUT 只返回 PUT，不返回 POST fields。
- 预签名 GET 有限时长。
- 权限错误、Bucket 不存在、对象不存在的错误映射。
- Secret 不进入错误消息。

#### StorageService

- Vercel 缺失任一 R2 环境变量时启动失败。
- Vercel 启动不读取 MinIO 凭据。
- Vercel active backend 强制为 R2。
- Vercel 更新/测试存储配置返回 409。
- Self-hosted 默认 MinIO 不回归。
- Self-hosted OSS 设置和 direct/proxy 约束不回归。
- `backendFor()` 能读取三种 backend。

#### 上传

- 文件、课堂文件、论坛图片、Banner 的 sign/confirm/abort。
- 未登录和无权限。
- 非法名、空名、控制字符、`.`/`..`。
- 同名和同批次重复。
- 大小超限和配额不足。
- PendingUpload 过期。
- R2 对象不存在。
- Stat 大小不符。
- 重复 Confirm。
- Abort 后重复调用。
- Confirm 数据库失败后的补偿清理。
- 论坛图片真实文件头、尺寸和数量。
- Banner 替换及旧对象删除失败。
- 每用户未完成上传上限。

#### Redis/Cron

- 同一实例复用一个 Redis 客户端。
- 本地 fallback。
- Vercel fail closed。
- Cron 无 Token、错误 Token 返回 401。
- 正确 Token 运行清理。
- Redis 锁防止并发。
- 重复执行幂等。

#### Server Status/HTTPS

- Self-hosted 返回 `mode=host`。
- Vercel 返回 `mode=serverless`。
- Vercel 不写 ServerMetricSample。
- Vercel HTTPS 写接口返回 409。
- Self-hosted Unix Socket 行为不回归。

#### 数据迁移和基线工具

- 对象迁移工具默认 dry-run，显式参数才允许写入。
- MinIO、OSS 和已存在 R2 对象的迁移分支。
- 成功复制后才更新单行 backend。
- 对象缺失、大小不符、目标写入失败和数据库更新失败。
- 中断后恢复、重复执行和已完成对象跳过。
- 验证脚本能够发现行数不符、孤立关系、无正常最高管理员、AI Key 无法解密和 R2 缺失对象。
- 唯一 baseline 可以在空测试数据库从零创建完整 schema。
- baseline 包含 `ForumPostVote_value_check` 手写约束。
- 恢复数据库标记 baseline 后，`migrate status` 无 pending 且 `_prisma_migrations` 只有一行。
- 旧自托管数据库的 baseline 过渡脚本能识别精确历史并安全重复执行。
- 过渡脚本遇到未知 migration、失败记录、checksum 不符或 schema drift 时拒绝执行。

### 8.2 Web 测试

- `form_post` 上传。
- `put` 上传。
- PUT Header、进度和取消。
- 网络失败、URL 过期、Confirm 失败。
- Vercel 下不 fallback relay。
- 两个并发、第三个等待。
- 一个非法/重复文件不阻塞有效文件。
- 论坛图片上传顺序和数量。
- Banner 上传和替换。
- R2 管理页只读状态。
- Serverless 状态视图。
- Vercel HTTPS 提示。
- 桌面和窄屏无横向溢出，上传浮窗按钮可达。

### 8.3 静态验证

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm validate
```

共享类型变更后先运行：

```bash
pnpm --filter @liveboard/shared build
```

### 8.4 Vercel Preview 验证

1. 两个 Project 从个人镜像仓库部署同一 Git 提交。
2. Web `/api/health` 命中同一提交的 API Preview，而不是 Production API。
3. API Region 为 `sin1`。
4. Preview 使用独立 Neon、Upstash、R2 Bucket。
5. Session Cookie 为 Secure、HttpOnly、SameSite=Lax。
6. 任意直接访问 API Project 不获得 Web Session。
7. R2 Bucket 保持 Private。
8. 无签名 URL无法上传/下载。

上传验证：

- 50 MB 独立文件。
- 100 MB 课堂文件。
- 10 MB 论坛图片。
- 5 MB Banner。
- 中途取消。
- URL 过期。
- Confirm 大小不符。
- 每用户未完成上传上限。

读取验证：

- 附件下载 302 到 R2。
- 签名 URL 过期后失效。
- PDF 25 MB 流式预览。
- Markdown/TXT 2 MB 内预览。
- 权限撤销后 inline 资源无法继续读取。
- 论坛匿名图片不暴露上传者和原文件名。

AI 验证：

- 回答逐块输出。
- 浏览器断开后上游取消。
- 110 秒上游超时返回明确错误。
- 不发生 rewrite 120 秒超时后无提示断开。

Cron 验证：

- `vercel.json` 每天只执行一次，能够在 Hobby 部署。
- 手动调用正确 Token 可清理。
- 错误 Token 不清理。
- 重复运行无重复删除错误。
- R2 Lifecycle 能删除遗留 `pending/` 对象。

### 8.5 自托管回归

```bash
pnpm infra:up
pnpm dev
```

验证：

- PostgreSQL、Redis、MinIO 正常。
- 文件、课堂文件、论坛图片、头像、Banner、favicon 上传。
- MinIO 下载和预览。
- 阿里云 OSS 设置、测试、直传和下载。
- Storage 管理页仍可编辑。
- 宿主机 Server Status 历史。
- HTTPS Agent 页面和操作。
- Docker Compose Production Build。
- Release 和部署脚本测试。

## 9. 推荐实施顺序

1. 建立个人 GitHub 私有镜像，确认 Vercel Hobby 可以连接；不要先修改业务代码后才发现部署入口不可用。
2. 新增 `DEPLOYMENT_TARGET` 和环境变量验证，保持默认 `self_hosted`。
3. 在 `schema.prisma` 中完成 R2、PendingUpload kind/backend/forum 关联等最终结构修改，但暂不把临时增量 migration 作为最终历史提交。
4. 实现 R2 Backend 和 StorageService 惰性初始化。
5. 完成三后端读写兼容测试，确保 MinIO/OSS 不回归。
6. 把文件和课堂文件上传协议改为 `form_post | put` 判别联合。
7. 实现 Web XHR PUT、进度、取消和无 relay fallback。
8. 为论坛图片和 Banner 增加 sign/confirm/abort。
9. 统一 Redis Service，实现生产 fail-closed。
10. 禁用 Vercel 进程内定时器，增加每日 Cron、Redis 锁、惰性清理和 R2 Lifecycle。
11. 改造 Server Status 和 HTTPS 管理能力视图。
12. 将 AI 上游超时调整为 110 秒并测试流式中断。
13. 修复所有可能超过 4.5 MB 的 Buffer 响应，改为流式 pipe 或 R2 直出。
14. 实现对象迁移和数据验证脚本，确保默认 dry-run、可恢复和逐对象切换 backend。
15. 冻结最终 schema，运行完整验证，并在移除旧 migration 前保留可恢复 Git tag/历史。
16. 生成并审计唯一 baseline，补回 `ForumPostVote_value_check` 等手写结构 SQL。
17. 实现并测试既有自托管数据库的 baseline 历史过渡脚本，确保旧 Release 升级不会重复建表。
18. 在空测试数据库验证单 baseline 能完整建库；在旧数据副本上完整演练 dump、恢复、离线升级、对象迁移和 baseline resolve。
19. 创建 API Vercel Project，取得真实 Project ID；再创建 Web Project 并配置 Related Projects 和 `/api` rewrite。
20. 配置独立 Preview/Production Neon、Upstash、R2 和所有 Secret；Production 保留旧 `AI_ENCRYPTION_KEY`。
21. 完成 Preview E2E、桌面/窄屏视觉验证、安全验证和 Hobby 用量检查。
22. 进入正式维护窗口，停止旧系统写入，执行最终数据库恢复、离线升级、R2 对象迁移和校验。
23. 标记唯一 baseline；确认不运行 production bootstrap，并验证迁移过来的最高管理员。
24. 部署 Vercel Production；验收成功后恢复访问，旧数据库和旧对象存储继续只读保留。
25. 更新 README、数据迁移/部署教程、环境变量示例、AGENTS.md 和 CI。
26. 执行完整 `pnpm validate`、自托管旧库升级演练以及 MinIO/OSS/Release 回归。

## 10. 完成标准

只有同时满足以下条件才算“完整适配”：

- Vercel Hobby 能从个人 Git 镜像完成 Web/API Git Deployment。
- Web 和 API Preview 对应同一提交。
- 浏览器只访问同源 `/api`。
- R2 为私有 Bucket，凭据只在服务端环境变量。
- 所有超过 4.5 MB 的上传均不经过 Vercel Function Body。
- 文件、课堂文件、论坛图片和 Banner 的进度、取消、确认和补偿完整。
- 下载走 R2，inline 资源保持 API 权限校验。
- Redis、Cron、Server Status、HTTPS 和 AI 行为符合 Serverless 限制。
- Preview/Production 数据完全隔离。
- 现有 PostgreSQL 业务数据已经迁移，关键业务表行数和关联验证通过。
- 所有数据库引用的 MinIO/OSS 对象已复制并校验到 R2，缺失对象数为 0。
- 所有成功迁移的存储记录已逐行切换为 `storageBackend=r2`，未通过校验的对象不会被错误标记。
- 最终仓库只保留 `00000000000000_baseline_v1` 和 `migration_lock.toml`，旧 migration 可从 Git tag/历史恢复。
- 正式目标数据库 `_prisma_migrations` 只有唯一 baseline，且 `migrate status` 无 pending 或 drift。
- 既有自托管数据库可通过受控过渡脚本升级；未知 migration 历史会被拒绝，不会自动篡改。
- Production 保留原 `AI_ENCRYPTION_KEY`，迁移后的 AI Provider 配置可正常解密。
- 迁移后不运行 bootstrap，至少一名迁移过来的正常最高管理员可以登录。
- 旧数据库和旧对象存储保持可回滚，没有在本次切换中删除。
- Vercel 管理页只读显示 R2；Self-hosted 管理页保持可编辑。
- Docker/MinIO/阿里云 OSS 和 `.run` 发布链路没有回归。
- 完整 `pnpm validate` 通过，并完成真实 Vercel Preview 浏览器验证。

## 11. 参考资料

- [Vercel NestJS zero-configuration support](https://vercel.com/changelog/zero-configuration-support-for-nestjs)
- [Vercel Monorepos and Related Projects](https://vercel.com/docs/monorepos)
- [Vercel Limits](https://vercel.com/docs/limits)
- [Vercel Function Limits](https://vercel.com/docs/functions/limitations)
- [Vercel large upload guidance](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions)
- [Vercel Cron usage and Hobby limits](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel Hobby and commercial-use policy](https://vercel.com/docs/limits/fair-use-guidelines)
- [Vercel Pricing](https://vercel.com/pricing)
- [Cloudflare R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/)
- [Cloudflare R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)
- [Cloudflare R2 S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Prisma Serverless deployment](https://www.prisma.io/docs/orm/v6/prisma-client/deployment/serverless)
- [Prisma Squashing migrations](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/squashing-migrations)
- [Prisma Baselining a database](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/baselining)
- [Prisma migrate resolve](https://www.prisma.io/docs/cli/migrate/resolve)
