# HFLive Auth 用户同步加固 + 成员管理改造实施规划

> 本文档是可直接执行的实施规划，面向实现代理（Implementer）。涉及两个仓库：
>
> - **LiveBoard**：`/Users/xiang/Desktop/liveboard`（Next.js Web + NestJS API + Prisma）
> - **live_sso（HFLive Auth）**：`/Users/xiang/Desktop/live_sso`（Next.js + Prisma + Better Auth）
>
> 实施前先阅读 LiveBoard 仓库根目录 `AGENTS.md`（开发流程、UI 设计原则、验证清单）与
> `docs/hflive-auth.md`（现有集成约定），以及 live_sso 仓库 `docs/reference/` 下的
> phase4/phase5/phase6/phase7 契约文档。除非本文档明确要求，不得改动两个仓库的其他行为。

---

## 1. 背景与根因诊断

### 1.1 症状

用户反馈 LiveBoard 接入 HFLive Auth 后同步做得不好，具体表现：

- 在 HFLive Auth 修改**显示名/用户名**后，LiveBoard 不更新；
- 在 HFLive Auth 更换**头像**后，LiveBoard 不更新；
- 目标态：未来**仅使用 HFLive Auth 登录**（`AUTH_MODE=hflive_oidc`），本地登录弃用，
  所有用户资料统一以 HFLive Auth 为权威。

### 1.2 既有同步链路设计（两边文档一致）

```
HFLive 侧资料/状态变更
  → 同事务写 OutboxEvent 表（live_sso）
  → Cloudflare Worker 每分钟 cron 调 POST /api/internal/outbox/dispatch 派发
  → webhook POST 到 LiveBoard /api/internal/hflive/events（HMAC 签名）
  → LiveBoard 把事件当"提示"，回拉 Directory API 取权威资料
  → 更新本地 User + ExternalIdentity
```

### 1.3 根因链（已用代码证据确认）

按影响排序：

1. **生产 webhook 投递从未验收**。live_sso `docs/development-progress.md`（2026-08-11）
   明确写着"尚缺生产 webhook 投递证据"。且 live_sso 的 webhook URL / 订阅 / 密钥
   **在客户端创建后没有任何修改入口**（`PATCH /api/admin/clients/[clientId]` 只支持
   disable/enable/rotate_secret/update_configuration，`updateClientConfiguration` 不触碰
   `ClientWebhook` 表）——一旦登记错误（如登记了 Vercel 随机部署 URL），事件会永久
   积压在 OutboxEvent 里，除了重建客户端或手改数据库无解。
2. **LiveBoard 收到事件但 Directory 回拉失败时静默丢弃**。
   `apps/api/src/modules/hflive-auth/hflive-auth.service.ts` `processWebhook`：
   资料回拉失败时仍把事件行写入 `ExternalIdentityEvent`（outcome=IGNORED），
   而控制器（`hflive-auth.controller.ts:165-179`）对所有验证通过的投递一律返回 204。
   outbox 认为投递成功不再重试；即使重试，同一 `eventId` 也会被幂等去重
   （`findUnique({ where: { eventId } })` → `{ duplicate: true }`）挡掉。
   结果：`syncState=ERROR` 永久滞留，资料陈旧到该用户下次重新 OIDC 登录为止。
3. **完全没有定期对账**。LiveBoard 没有任何 cron / 启动拉取清扫
   `syncState=ERROR`、`PROFILE_CONFLICT` 的身份；`apps/api/vercel.json` 只有
   storage-cleanup 与 backup 两个 cron。
4. **管理端对同步状态完全失明**。`GET /admin/users/:id/hflive-identity`、
   `POST /admin/users/:id/hflive-link` 后端接口已实现，但前端从未调用
   （`apps/web/lib/api/index.ts` 无对应封装）；成员列表没有任何身份/同步字段。
5. 头像是外部 URL 快照（机制本身正确：HFLive 头像 URL 带 `?v=` 版本号，
   每次更换 URL 变化），只要 1/2 任一发生，存储的 URL 永远不更新 → 头像陈旧。

### 1.4 部署约束

两个服务都部署在 **Vercel Hobby**：无常驻进程、无 `setInterval`、
cron 频率最低每天一次且 cron 条数受限（LiveBoard 已有 2 条）。
所有方案必须 Serverless 安全：推送靠 outbox + 外部 cron，拉取对账靠请求触发或日级 cron。

---

## 2. 两侧系统契约速查（实现者无需重新探索）

### 2.1 外发事件（live_sso → LiveBoard）

只有两种事件类型（`live_sso/src/lib/security/client-service.ts:8` `EVENT_TYPES`）。
投递时顶层附带 `id`（事件 UUID）与 `type`，其余为 payload 字段：

| 事件                               | payload 字段                                                         | 说明         |
| ---------------------------------- | -------------------------------------------------------------------- | ------------ |
| `user.status.changed`              | `webhookId, clientId, subject, status(ACTIVE\|DISABLED), occurredAt` | 全局启停     |
| `user.profile.changed`（改名变体） | `webhookId, clientId, subject, name, occurredAt`                     | 不含 picture |
| `user.profile.changed`（头像变体） | `webhookId, clientId, subject, picture, version, occurredAt`         | 不含 name    |

**事件只是提示（hint）**：payload 不完整是刻意设计，接收方必须回拉 Directory 取权威资料。
不存在 `user.created` / `user.deleted` / 改用户名 / 改邮箱事件（live_sso 目前也没有这些变更 API）。

### 2.2 Outbox 投递语义（live_sso）

- 事务 outbox：变更与 `OutboxEvent` 行同事务写入（Serializable）；
  派发是独立的 worker 扫描，不在请求生命周期内。
- 触发：Cloudflare Worker cron（每分钟）→ `POST /api/internal/outbox/dispatch`
  （Bearer `CRON_SECRET`/`OUTBOX_WORKER_SECRET`）。
- 投递：`POST` 到 `ClientWebhook.endpointUrl`，**10 秒超时**，`redirect: "error"`，
  **只有 2xx 算成功**；请求头：
  - `x-hflive-event-id`：事件 UUID，全局幂等键；
  - `x-hflive-timestamp`：Unix 秒；
  - `x-hflive-signature`：`v1=` + hex `HMAC-SHA256(secret, "${timestamp}.${rawBody}")`（对原始 body）。
- 重试：指数退避 `2^min(attempt,10)` 秒、封顶 60 分钟；`attemptCount >= maxAttempts(10)`
  进 `DEAD_LETTER`（`lastErrorCode` 记录 `HTTP_<status>` 或 `DELIVERY_FAILED`）。
- webhook 行缺失/失效或 client 未启用时事件被静默标记完成（discarded）。
- **无顺序保证**：接收方用 `occurredAt` 做乱序保护（LiveBoard 已实现，仅限状态事件）。

### 2.3 Directory API（live_sso，M2M client_credentials）

- `GET /api/directory/users/{userId}`（scope `directory:user:read`）→
  `{ subject, preferredUsername, name, picture, email, emailVerified, status, updatedAt }`，
  `private, no-store`；未知 uuid 返回 404。
- `GET /api/directory/users/{userId}/status`（scope `directory:user:status`）→
  `{ subject, status, updatedAt }`。
- **没有列表 / 增量端点**，只能按 subject 单查；token 端点
  `POST /api/auth/oauth2/token`（client_credentials）。
- LiveBoard 的 directory client 已同时具备两个 scope（见 `docs/hflive-auth.md`）。

### 2.4 头像 URL 契约

- 形式：`https://auth.hsfz.live/api/profile/avatar/{userId}?v={version}`；
  公开、无需鉴权；`public, max-age=31536000, immutable` + sha256 ETag。
- 每次更换头像 `version+1`、`User.image` 改写为新 URL、发出头像变体事件；
  旧版本保留 ≥30 天。**LiveBoard 只需存最新 URL 字符串，不需要缓存字节、不需要自己加版本号。**

### 2.5 LiveBoard 侧关键结构（`apps/api/src/modules/hflive-auth/`）

- `hflive-auth.config.ts`：`AUTH_MODE=local|hybrid|hflive_oidc`（默认 local）；
  issuer 固定 `https://auth.hsfz.live`；`enabled = mode !== "local"`；
  `profileUrl` 生成 `https://auth.hsfz.live/profile?returnTo=...`；
  `validationErrors()` 供 `/health` readiness。
- `hflive-auth.service.ts`（约 1169 行）核心方法与行号锚点：
  - `processWebhook` 418-650：签名/信封校验 → 事务前校准（454-476：
    ACTIVE 状态事件 `directory.getStatus`；profile 事件 `loadVerifiedProfile`）→
    Serializable 事务（P2034 重试 3 次）：eventId 幂等 → 未知主体 IGNORED →
    乱序保护（仅状态事件）→ 应用变更 → **始终写事件行**。
  - `checkExternalSession` 332-416：ActiveUserGuard 每请求调用；
    `STATUS_FRESH_MS=15min` 节流、10 秒 DB 租约合并并发、
    `STATUS_GRACE_MS=60min` 故障宽限；只拉 `getStatus`，**不回写资料**。
  - `resolveLogin` 652-734（JIT 建号 + 冲突票据）、`linkIdentity` 736-820
    （绑定要求本地用户名与 HFLive `preferred_username` 规范化一致）、
    `loadVerifiedProfile` 822-847、`syncExistingProfile` 912-936、
    `updateCompatibleProfile` 938-974（displayName 总是写；username/email
    仅在无大小写不敏感冲突时写）、`identitySnapshot` 1096-1107、
    `disableIdentity` 987-1005、`adminIdentityStatus` 298-330、
    `verifyWebhook` 1025-1047（±300s 时间窗、timingSafeEqual、支持 previous secret）。
- `directory.service.ts`：`getStatus` / `getProfile`；**每次调用都重新获取
  client_credentials token（无缓存）**；`AbortSignal.timeout(5_000)`。
- `hflive-auth.controller.ts`：`POST /internal/hflive/events`（165-179，`@Public`、
  204、**丢弃 processWebhook 返回值**）；`HfliveAdminController`（143-162）：
  `POST /admin/users/:id/hflive-link`、`GET /admin/users/:id/hflive-identity`。
- `apps/api/src/main.ts`：11 行 `bodyParser: false`；22-25 行对 webhook 路径挂
  `express.raw({ limit: "64kb", type: "application/json" })`（HMAC 需要原始 body）。
- Prisma（`apps/api/prisma/schema.prisma`）：`User` 161-216（无 externalId 列，
  关联全靠 ExternalIdentity）；`ExternalIdentity` 218-246（`issuer_subject`、
  `userId_issuer` 双唯一；`externalStatus/syncState/syncErrorCode/linkMethod`
  等枚举 21-38）；`ExternalIdentityEvent` 249-261（`eventId @id` 幂等）。
- 状态语义：本地 `User.status` 与外部状态 AND；DISABLED 事件递增 `sessionVersion`
  踢会话，**从不改写本地 `User.status`**；外部恢复 ACTIVE 不覆盖本地停用。
- 头像展示：`apps/api/src/modules/auth/auth.service.ts` `toSummary` 约 850-859：
  `avatarUrl = externalPicture ?? 本地头像`（`externalPicture` 仅在 `hfliveConfig.enabled`
  时读取）。`updateProfile` 411-447 / `updateAvatar` 449-456 对已绑定用户拒绝改
  显示名/头像；`hasAuthoritativeExternalProfile` 821-830。
- 守卫：`apps/api/src/common/active-user.guard.ts:118-123` 每认证请求调
  `checkExternalSession`。

---

## 3. 工作流 A：同步链路加固（修复症状的核心）

### A1. live_sso：webhook 注册可修复、投递可观测

**目标**：配错的 webhook URL 不必重建客户端即可修正；管理端能看到投递是否健康。

改动文件：

- `live_sso/src/lib/security/client-service.ts`
- `live_sso/src/app/api/admin/clients/[clientId]/route.ts`
- `live_sso/src/components/admin-console.tsx`
- 必要的 zod schema / 测试文件（跟随现有测试组织方式）

规格：

1. `PATCH /api/admin/clients/[clientId]` 新增两个 action：
   - `update_webhook`：body 带 `endpointUrl`（复用现有 `assertWebhookUrl`：
     生产必须 HTTPS、无凭据/fragment）与可选 `eventTypes`（只允许
     `EVENT_TYPES` 子集）。客户端无 webhook 行时报错或按需创建（保持
     `@@unique([clientId])` 一客户端一 webhook）。
   - `rotate_webhook_secret`：生成新 32 字节密钥、AES-256-GCM 加密存库
     （复用 `webhook-secret.ts`），**响应中一次性明文返回**，之后不可再读。
   - 两者都要求平台管理员会话（与现有 admin 路由一致），写 AuditEvent。
2. 新增投递状态查询（供管理 UI）：按 client 聚合 `OutboxEvent` 的
   `PENDING/PROCESSING/DEAD_LETTER` 计数 + 最近一条失败的
   `lastErrorCode/updatedAt`。可以是 `GET /api/admin/clients/[clientId]/webhook-status`，
   或并入现有 client 详情接口。
3. `admin-console.tsx`：已登记客户端卡片增加——编辑 webhook URL、轮换密钥
   （带"仅显示一次"提示，复用现有一次性凭据面板样式）、投递状态
   （PENDING/死信计数 + 最近错误）。
4. 兼容性：LiveBoard 支持 `HFLIVE_WEBHOOK_PREVIOUS_SECRET` 双密钥验证，
   轮换流程文档化：live_sso 轮换 → 把旧密钥填入 LiveBoard 的
   `HFLIVE_WEBHOOK_PREVIOUS_SECRET` → 部署 LiveBoard → 更新主密钥。

测试：新增/扩展 live_sso 现有 vitest 用例（update_webhook 校验、密钥轮换一次性返回、
webhook-status 聚合）。

### A2. LiveBoard：webhook 瞬态失败可重试（核心修复 #1）

**目标**：Directory 回拉失败不再静默吞掉事件，让 outbox 的指数退避重试真正生效。

改动文件：

- `apps/api/src/modules/hflive-auth/hflive-auth.service.ts`（`processWebhook`）
- `apps/api/src/modules/hflive-auth/hflive-auth.controller.ts`

规格：

1. `processWebhook` 返回类型扩展为可判别联合，例如
   `{ kind: "duplicate" } | { kind: "ignored", reason: ... } | { kind: "applied" } | { kind: "retryable" }`。
2. **瞬态失败 → retryable，且不进事务**：
   - `user.profile.changed` 而 `loadVerifiedProfile` 抛错（现状 454-476 行捕获后
     `refreshedProfile = null`）→ 直接返回 `{ kind: "retryable" }`，
     **不写事件行、不更新 `syncState`**（否则重试会被幂等去重挡掉）。
   - `user.status.changed` ACTIVE 而校准未确认（`calibratedStatus !== "ACTIVE"`，
     含 Directory 抛错）→ 同样返回 retryable，**不更新 `lastStatusEventAt`**
     （否则重试会命中乱序保护被当 STALE 丢弃）。
   - 幂等依然成立：事件行只在终态决策时写入；并发重试由 eventId 唯一键
     - P2002 兜底（现有 637-643 行逻辑保留）。
3. **终态维持现状**：DISABLED 立即应用（递增 sessionVersion）；APPLIED、
   重复、未知主体（UNKNOWN_SUBJECT）、乱序（STALE_EVENT）都是终态。
4. 控制器按返回值映射 HTTP 状态：
   - `retryable` → **503**（outbox 非 2xx 即重试）；
   - 其余 → 204；
   - **`AUTH_MODE=local`（`!config.enabled`）→ 直接 204 丢弃**，
     替换现在的 `requireEnabled()` 抛错（避免本地模式期间无效重试 10 次进死信；
     本地模式下外部身份不权威，重新启用后由登录/对账补齐）。
5. 签名/信封校验失败维持 401/400（发送方重试至死信是正确行为，坏请求不该成功）。

测试（扩展 `hflive-auth.service.spec.ts` / `hflive-auth.integration.spec.ts`）：

- profile 事件 + Directory 失败：不写事件行、控制器 503；随后 Directory 恢复，
  同一 eventId 重投 → APPLIED、资料落库；
- 重复投递仍然只应用一次；
- ACTIVE 事件校准失败 → retryable，重试后 `lastStatusEventAt` 正确设置。

### A3. LiveBoard：请求驱动的 15 分钟全量资料对账（核心修复 #2）

**目标**：即使 webhook 完全丢失，活跃用户的显示名/用户名/邮箱/头像/状态
也会在 15 分钟内自愈（用户任一认证请求触发）。

改动文件：

- `apps/api/src/modules/hflive-auth/hflive-auth.service.ts`
  （`checkExternalSession` + 抽共享方法）

规格：

1. 抽一个共享方法（如 `applyVerifiedProfile`），承载"目录资料 → 本地写入"的
   冲突感知更新逻辑（现在散落在 webhook 事务 558-604、`syncExistingProfile`
   912-936、`updateCompatibleProfile` 938-974 三处，行为必须保持一致）：
   - `User.displayName` 总是更新；
   - `username/email/emailNormalized` 仅在无其他用户的大小写不敏感冲突时更新；
   - `ExternalIdentity` 写 `identitySnapshot` + `lastProfileSyncedAt`，
     `syncState = 冲突 ? PROFILE_CONFLICT : CURRENT`；
   - 支持在事务（webhook）与非事务（对账）两种上下文复用。
2. `checkExternalSession` 的周期刷新从 `directory.getStatus` 改为
   `directory.getProfile`（一次调用同时得到状态与完整资料；
   LiveBoard directory client 已有 `directory:user:read` scope）：
   - 返回 ACTIVE → 确认状态（`lastStatusConfirmedAt`、清租约）**并**执行
     `applyVerifiedProfile` 回写资料；
   - DISABLED / 404 → 维持现有 `disableIdentity`；
   - 瞬态失败 → 维持现有 60 分钟宽限逻辑。
   - 节流（15 分钟）、租约、宽限窗口语义全部保持不变。
3. 登录路径 `syncExistingProfile` 改为复用 `applyVerifiedProfile`，消除重复实现。

测试：扩展 spec 覆盖"周期刷新同时修复 syncState=ERROR 的资料"、
"周期刷新遇到用户名冲突 → PROFILE_CONFLICT 且 displayName 仍更新"。

### A4. LiveBoard：每日兜底对账 cron

**目标**：不活跃用户的 ERROR/PROFILE_CONFLICT 身份也有兜底修复；Hobby 套餐
cron 条数受限，通过合并解决。

改动文件：

- 新增 `apps/api/src/modules/hflive-auth/hflive-cron.controller.ts`
- `apps/api/vercel.json`
- `apps/api/src/modules/hflive-auth/hflive-auth.module.ts`（注册新控制器）

规格：

1. 新控制器完全复制 `apps/api/src/modules/storage/storage-cron.controller.ts`
   的安全模式：`@Controller("internal/cron")`、`@Public()`、
   `Authorization: Bearer ${CRON_SECRET}` 恒定时间比较、Redis `SET NX PX` 锁
   （锁键如 `liveboard:cron:identity-sync`，TTL 10 分钟）、未授权 401 不泄露信息。
2. `GET /internal/cron/identity-sync`：清扫满足任一条件的 `ExternalIdentity`：
   `syncState != CURRENT`，或 `lastProfileSyncedAt` 为空 / 早于 7 天前。
   **单次上限 30 条**（Hobby 函数时长受限；token 缓存后每条一次 HTTP 往返，
   积压靠每日多轮消化），逐条 `getProfile` + `applyVerifiedProfile`；
   单条失败跳过继续，不中断整批；结束输出计数日志。
3. `GET /internal/cron/daily`：顺序执行"存储清理 + 身份对账"，
   两个子任务各自持有自己的 Redis 锁（存储清理复用 `StorageService`
   现有清理入口，保持其行为与幂等性）。
4. `apps/api/vercel.json`：把 `storage-cleanup` 条目替换为
   `{ "path": "/internal/cron/daily", "schedule": "3 4 * * *" }`，
   保留 backup 条目不动（合计仍 2 条）。旧的 `storage-cleanup` 端点保留
   （自托管/回滚兼容），只是 Vercel cron 不再指向它。

测试：控制器级 spec（401 无密钥、锁去重、清扫只处理目标身份、单条失败不中断）。

### A5. LiveBoard：头像显示统一走 HFLive

**目标**：已绑定用户不再回退本地旧头像（用户已确认"统一走 auth 信息"）。

改动文件：

- `apps/api/src/modules/auth/auth.service.ts`（`toSummary` 约 850-859 及
  公开主页查询的同一取值路径）

规格：`hfliveConfig.enabled` 且用户存在 HFLive `ExternalIdentity` 时，
`avatarUrl = identity.picture ?? null`（HFLive 无头像时显示首字母占位，
而不是本地历史头像）。`AUTH_MODE=local` 回滚时行为不变（恢复本地头像）。
同步更新受影响的 spec（`auth.service.spec.ts` 中
"prefers the HFLive picture..."、"uses the refreshed HFLive picture..." 等用例）。

### A6. LiveBoard：Directory token 缓存

**目标**：去掉每次 Directory 调用前的 token 往返（降低 webhook 处理时长与
cron 批次时长，减少 Hobby 函数超时风险）。

改动文件：`apps/api/src/modules/hflive-auth/directory.service.ts`

规格：

- client_credentials token 缓存到 Redis（键如 `liveboard:hflive:directory-token`，
  TTL = 响应 `expires_in - 60s`）；进程内单飞（共享 in-flight Promise）避免并发重复获取；
- Redis 不可用时回退为现有的每次获取（开发环境内存 fallback 可接受，
  遵循仓库 RedisService 约定）；
- 请求收到 401 时清除缓存并重取一次（应对上游轮换）。

---

## 4. 工作流 B：成员管理改造（SSO-aware，参考 Google Workspace）

设计原则（来自 Google Workspace 参考，转译为 LiveBoard 语境）：

1. **字段所有权显式化**：HFLive 权威字段（用户名/邮箱/显示名/头像）在管理端只读，
   明确标注"由 HFLive Auth 管理"并给出跳转入口；管理员只操作 LiveBoard 本地
   字段（角色、状态、AI 限额、标签、配额）。
2. **列表即状态**：绑定与同步状态一眼可见，可筛选"需处理"。
3. **生命周期克制**：保留停用为主要手段，不引入成员删除（用户已确认）。

### B1. 列表接口扩展身份字段（后端）

改动文件：

- `apps/api/src/modules/users/users.service.ts`（`listUsers` 约 77 行）
- `packages/shared/src/types.ts`（`AdminUserSummary` 217-220）

规格：

- `listUsers` 为每个用户附带 issuer 为 `https://auth.hsfz.live` 的
  `ExternalIdentity` 摘要；
- `AdminUserSummary` 增加：
  ```ts
  hflive?: {
    linked: boolean;
    syncState: "CURRENT" | "PROFILE_CONFLICT" | "ERROR" | null;
    externalStatus: "ACTIVE" | "DISABLED" | "UNKNOWN" | null;
    linkMethod: "JIT" | "LOCAL_PASSWORD" | "LOCAL_SESSION" | "ADMIN" | null;
    lastProfileSyncedAt: string | null; // ISO
  };
  ```
- 保持全量返回（用户规模小；分页/服务端搜索本轮不做）。

### B2. `PATCH /admin/users/:id` 感知 HFLive（后端）

改动文件：`apps/api/src/modules/users/users.service.ts`（`updateUser` 约 708 起）

规格：

- 更新前查询目标的 HFLive `ExternalIdentity`；
  当 `hfliveConfig.enabled` 且已绑定时：
  - 拒绝修改 `displayName`（BadRequest，文案与个人设置页一致：
    "统一身份资料请前往 HFLive Auth 修改"，对齐 `auth.service.ts:419-427`）；
  - 拒绝设置 `password`（"统一身份密码由 HFLive Auth 管理"；
    对齐 `auth.service.ts:449-456` 的头像拒绝模式）。
- `systemRole`、`status`、`storageQuotaBytes`、`aiCallLimit`、tags 不受影响；
  现有"至少一位正常 super_admin"事务不变量、sessionVersion 递增逻辑保持。
- `users` 模块需要注入 `HfliveAuthConfig`（该模块是 `@Global()`，直接注入即可）。

### B3. 管理端新端点（后端）

改动文件：

- `apps/api/src/modules/hflive-auth/hflive-auth.controller.ts` + `hflive-auth.service.ts`
- `apps/api/src/modules/users/users.controller.ts` + `users.service.ts` + DTO

规格：

1. `POST /admin/users/:id/hflive-sync`（放 `HfliveAdminController`）：
   - 权限模型与 `hflive-link` 一致（管理员；目标非 member 需 super_admin）；
   - 目标未绑定 → 404/409 明确报错；
   - 执行 `loadVerifiedProfile(subject)` + `applyVerifiedProfile`（A3 共享方法），
     Directory 失败返回 502/503 可重试语义；
   - 响应返回刷新后的 `adminIdentityStatus` 结构。
2. **改名**：`UpdateUserDto` 增加可选 `username: string`：
   - **仅 super_admin** 可改（其余 403）；
   - 校验复用用户名创建时的规则：共享命名规则（`packages/shared` 中资源命名
     校验，拒绝空名/超长/控制字符/零宽与双向控制字符/`.`/`..`）+
     大小写不敏感唯一性（排除自身，对齐 `createUser` 约 550 行的判重方式）；
   - 成功后递增目标 `sessionVersion`、写审计；
   - 用途说明（写进 UI 文案）：主要用于解决 PROFILE_CONFLICT——
     当某用户的 HFLive 用户名被另一个本地账号占用时，最高管理员给占用者改名。
     已绑定用户被改名后，其用户名会在下次同步时被 HFLive 值覆盖，这是预期行为。
3. `POST /admin/users/bulk-status`：body `{ ids: string[], status: "active"|"disabled" }`：
   - `ids` 上限 200（`ArrayMaxSize`）；
   - 逐个套用与单条更新相同的权限规则（admin 不能操作非 member；排除操作者自身），
     无权限/不存在的 id 计入 skipped；
   - 事务内 `updateMany`/逐条更新 + 受影响用户 `sessionVersion` 递增；
   - 返回 `{ updated: number, skipped: number }`。

### B4. 前端成员管理页改造

改动文件：

- `apps/web/lib/api/index.ts`（新增封装）
- `apps/web/app/app/admin/users/UserManagementClient.tsx`（约 1098 行）
- `apps/web/app/app/admin/users/users.css`
- `apps/web/lib/labels.ts`（新增身份状态 label，沿用现有 `userStatusLabel` 模式）
- 新增/扩展 `UserManagementClient.spec.tsx`

规格：

1. **lib/api**：新增 `hfliveSyncUser(id)`、`bulkUpdateUserStatus(ids, status)`；
   `updateUser` 透传新 `username` 字段。页面加载时调用 `GET /auth/config`
   （复用登录页现有客户端函数）取得服务端 `mode`。
2. **列表新增「统一身份」列**（状态列之后）：
   - 未绑定 → 弱化的"未绑定"文字；
   - 已绑定按优先级显示：`外部停用`（externalStatus=DISABLED）→
     `同步冲突`（PROFILE_CONFLICT）→ `同步异常`（ERROR）→ `正常`；
   - 悬停 tooltip 显示最近同步时间（`lastProfileSyncedAt`）与绑定方式；
   - 样式遵循 AGENTS.md 密度约定：紧凑文字/小徽章，不用大色块。
3. **工具栏新增身份筛选**（全部 / 已绑定 / 未绑定 / 需处理；
   需处理 = ERROR | PROFILE_CONFLICT | 外部停用），沿用现有
   `admin-user-filters` 的分段/下拉风格。
4. **状态列**合并展示：本地停用 + 外部停用分别可辨（如"已停用（统一身份）"）。
5. **编辑弹窗按字段所有权分区**（替换现有单一表单）：
   - 「统一身份」区（已绑定且 mode != local 时显示）：
     只读展示 HFLive 用户名/邮箱/显示名 + "由 HFLive Auth 管理，前往修改"
     链接（`GET /auth/config` 返回的 `profileUrl`）；绑定方式、最近同步时间、
     同步状态（冲突/异常时给出说明文案，对齐个人设置页
     `ProfileClient.tsx:533-601` 的措辞）；操作按钮：**立即同步**
     （调 `hflive-sync`，成功后刷新行数据）；super_admin 额外可见改名输入
     （说明其用途与"下次同步会被 HFLive 覆盖"的预期）。
   - 「本地管理」区：角色、状态、每日 AI 限额、成员标签（现有功能）。
   - 已绑定用户**隐藏**显示名输入框与重置密码输入框（服务端 B2 也会拒绝，双保险）。
   - 未绑定用户：弹窗维持本地字段 + 提示"该用户尚未绑定统一身份，
     绑定需用户在登录时自助完成"（不提供管理员输入 subject 的入口——
     live_sso 无按用户名查 subject 的 Directory 接口，属后续工作）。
6. **`AUTH_MODE=hflive_oidc` 时隐藏「创建成员」「批量导入」按钮**
   （依据 `GET /auth/config` 的服务端模式判断，不用 `NEXT_PUBLIC_*` 猜测）。
7. **批量栏**改调 `bulk-status` 端点（替换现在的 N 并发 PATCH），
   按返回的 updated/skipped 给反馈。
8. **反馈统一走全局悬浮通知**（AGENTS.md 约定；查找并复用现有 toast 工具，
   例如其他 client 页面使用的全局通知 hook），移除页面上残留的
   inline `error-text`/`success-text`。
9. CSS 遵循 `admin.css`/`redesign.css` 约定：语义变量、透明面板连续行、
   不加新的圆角外框卡片；窄屏（`responsive-table` data-label 堆叠）正常显示。

---

## 5. 已确认的产品决策与明确不做

### 已确认（用户 2026-08-11 决策）

| 决策         | 内容                                                                        |
| ------------ | --------------------------------------------------------------------------- |
| 目标认证模式 | 未来仅 `AUTH_MODE=hflive_oidc`（SSO 唯一登录），本地登录弃用                |
| 资料权威     | 已绑定用户的 username/email/显示名/头像一律以 HFLive 为权威，不回退本地旧值 |
| 创建入口     | hflive_oidc 模式下隐藏「创建成员」「批量导入」（JIT 成为唯一入口）          |
| 成员删除     | 不加，保持只能停用                                                          |
| 改名能力     | 做，仅 super_admin 可改                                                     |
| 改动范围     | live_sso 与 LiveBoard 两边都可改                                            |

### 明确不做（本轮）

- 成员删除 / 恢复窗口；解除绑定（unlink）端点与 UI；
- 成员列表服务端分页/搜索（规模小，保持全量返回）；
- live_sso 新增 `user.created`/`user.deleted`/改用户名事件；
- live_sso Directory 列表/增量/按用户名搜索接口（管理员代绑 UI 因此也不做）；
- 头像字节本地缓存/代理（版本化 URL 已足够）。

---

## 6. 实施顺序与里程碑

1. **M1（live_sso）**：A1 webhook 管理 API + 观测面板。部署后**先核查生产现状**：
   查 OutboxEvent 的 PENDING/DEAD_LETTER 计数与 `lastErrorCode`；
   确认 LiveBoard client 登记的 endpointUrl 是生产稳定地址
   `https://<liveboard-domain>/api/internal/hflive/events`（不能是 Vercel 随机
   Deployment URL）；如有误用新 API 修正。这一步很可能就是症状的直接根因。
2. **M2（LiveBoard）**：A2 + A3（两个核心修复）+ A5 + A6。
3. **M3（LiveBoard）**：A4 每日对账 cron 与 vercel.json 合并。
4. **M4（LiveBoard）**：B1–B3 后端。
5. **M5（LiveBoard）**：B4 前端。
6. **M6（收尾）**：更新 `docs/hflive-auth.md`（重试语义、对账机制、cron 变化）；
   在 `AGENTS.md` 开发纪要追加条目；双端全量验证通过后，
   将 LiveBoard 切到 `AUTH_MODE=hflive_oidc`（保留 breakglass 紧急入口，
   切换前置条件见 `docs/hflive-auth.md` "发布、迁移与回滚"节）。

每个里程碑独立可验证、可回滚；M2/M3 失败时 outbox 重试与既有登录同步仍保证最终一致。

---

## 7. 验证清单

### 7.1 自动化

- LiveBoard：
  - `pnpm --filter @liveboard/api test`（含新增用例）；
  - `pnpm test:phase6`（真实 PostgreSQL + Redis：并发 JIT、webhook 幂等、
    GETDEL 单次消费；见 `docs/hflive-auth.md` "本地验证"节）；
  - `pnpm validate`（format:check + typecheck + test + build）；
  - API 构建产物检查保持通过（`import("openid-client")` 字面量保留）。
- live_sso：运行其 vitest 套件（仓库根 `vitest.config.ts`；
  重点 `phase4-internal-apps.integration.test.ts`、`phase5-profile.integration.test.ts`
  及新增 admin client webhook 用例）。

### 7.2 手工端到端（hybrid 环境，双端本地或预发布）

| #   | 场景                                                                         | 预期                                                                                           |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 1   | HFLive 改显示名                                                              | ≤1 分钟（cron 派发）LiveBoard 列表/帖子/个人主页全部更新                                       |
| 2   | HFLive 换头像                                                                | 新 `?v=` URL 落库，页面头像即时更新，无旧图闪现                                                |
| 3   | HFLive 停用账号                                                              | 事件立即生效（sessionVersion 递增），该用户下次请求被拒                                        |
| 4   | 模拟 Directory 故障（停 live_sso 或改错 directory 密钥）时发 profile 事件    | webhook 返回 503；live_sso OutboxEvent 保持 PENDING 并退避重试；恢复后资料收敛；事件不重复应用 |
| 5   | 手动把某身份置为 `syncState=ERROR`（或等待场景 4）后，该用户发起任一认证请求 | 15 分钟窗口内 `checkExternalSession` 用 getProfile 修复为 CURRENT                              |
| 6   | 管理端「立即同步」                                                           | 返回最新 syncState，列表行刷新                                                                 |
| 7   | PATCH 改已绑定用户 displayName / 重置密码                                    | 400 + 明确文案                                                                                 |
| 8   | super_admin 改名占用用户名的账号                                             | 成功；原冲突身份下次同步变 CURRENT                                                             |
| 9   | 批量停用 3 个成员                                                            | 单次请求，updated=3，会话被踢                                                                  |
| 10  | hflive_oidc 模式下打开成员管理                                               | 创建/导入入口不可见；未绑定用户弹窗有说明                                                      |
| 11  | 每日 cron（可手工带 Bearer 触发）                                            | ERROR/陈旧身份被限量清扫，日志计数正确                                                         |

### 7.3 UI 检查（AGENTS.md 清单）

成员管理页在 1280×720 与 390×844：无横向滚动/截断；筛选与表格未被 Grid 拉伸；
编辑弹窗小屏可滚动、按钮可达；空/少量/大量数据三态合理；
菜单在视口边缘不溢出；可编辑输入控件字号 ≥16px（iOS 聚焦不缩放）。

### 7.4 生产验收（M6 前必须完成）

- live_sso 管理面板显示 LiveBoard client 投递健康（PENDING 能排空、无新增死信）；
- 真实改一次名 + 换一次头像，确认 LiveBoard 收敛；
- `/health` readiness 通过；随后按 6.M6 切换 AUTH_MODE。

---

## 8. 工程约定提醒（AGENTS.md 摘要，实施时严格遵守）

- 修改前先定位现有实现与共享类型；共享类型改动后先构建 `packages/shared`；
  Web typecheck 前先 `next typegen`。
- 前端 API 调用只走 `apps/web/lib/api`；内部路由只走 `apps/web/lib/routes.ts`。
- UI：语义变量（`--bg/--fill-*/--line*/--text*/--accent*`），不加页面级圆角外框；
  高密度工作区按钮分级（主操作深色实心/次要浅底/危险浅红/行内无底色）；
  反馈用全局悬浮通知；工作区组件保持缩小 30% 后的密度。
- Vercel 是 Serverless：不得引入进程内 `setInterval` 关键路径；
  cron 端点必须 `@Public()` + `CRON_SECRET` + Redis 锁（参照
  `storage-cron.controller.ts` 的注释与实现）。
- 不提交 `.env`、密钥与真实凭据；webhook/密钥相关值只走环境变量。
- 文档同步：完成后更新 `docs/hflive-auth.md` 与 `AGENTS.md` 开发纪要。
