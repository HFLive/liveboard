# HFLive Auth 后端接入

LiveBoard 支持 `local | hybrid | hflive_oidc` 三种服务端认证模式。默认值始终是
`local`，既有自托管实例升级不会自动启用外部认证。官方 OIDC issuer 固定为
`https://auth.hsfz.live`。

OIDC token exchange 使用 discovery 已声明支持的 `client_secret_post`。HFLive Auth
当前 OAuth Provider 对 RFC 6749 Basic 凭据中的表单编码字符兼容不完整，因此不要在
LiveBoard 侧改回 `client_secret_basic`，除非提供端已经完成对应兼容修正和真实回归。

## 配置

API 环境需要以下变量；它们都不得放入 `NEXT_PUBLIC_*` 或 Web 构建参数：

```text
AUTH_MODE=local
HFLIVE_OIDC_ISSUER=https://auth.hsfz.live
HFLIVE_OIDC_CLIENT_ID=
HFLIVE_OIDC_CLIENT_SECRET=
HFLIVE_OIDC_REDIRECT_URI=
HFLIVE_DIRECTORY_CLIENT_ID=
HFLIVE_DIRECTORY_CLIENT_SECRET=
HFLIVE_WEBHOOK_SECRET=
HFLIVE_WEBHOOK_PREVIOUS_SECRET=
HFLIVE_BREAKGLASS_ENABLED=false
```

`hybrid` 和 `hflive_oidc` 会把完整配置纳入 `/health` readiness。缺失或 issuer
不匹配时 readiness 返回 503，不会静默退回本地认证。OIDC 临时事务必须使用真实
Redis；即使开发环境允许其他功能内存降级，Redis 不可用时也不会开始授权。

在 HFLive Auth 管理端登记稳定的同源回调
`https://<liveboard-domain>/api/auth/hflive/callback`，以及 HTTPS webhook
`https://<liveboard-domain>/api/internal/hflive/events`。不要登记 Vercel 随机
Deployment URL。Directory client 至少需要 `directory:user:status` 和
`directory:user:read`。

## 后端端点

- `GET /auth/config`：公开返回服务端实际能力，不返回 secret。
- `GET /auth/hflive/start`、`GET /auth/hflive/callback`：authorization code、PKCE
  S256、state 和 nonce 登录。
- `POST /auth/hflive/link/password`：使用单次冲突票据和旧密码显式关联 member。
- `POST /auth/hflive/link/start`：已有本地会话在近期密码确认后发起本人关联。
- `POST /admin/users/:id/hflive-link`：管理员受控关联；高权限目标要求
  `super_admin`。
- `GET /admin/users/:id/hflive-identity`：返回不含 subject、token 或
  `emailNormalized` 的同步状态与资料快照（含统一用户名/邮箱/显示名），供管理端
  处理资料冲突和故障。
- `POST /admin/users/:id/hflive-sync`：管理员立即回拉 Directory 权威资料并应用，
  返回刷新后的身份状态；目标未绑定返回 400，Directory 瞬态故障返回 503。
- `PATCH /admin/users/:id`：已绑定用户拒绝修改显示名/重置密码（与个人设置一致）；
  `username` 字段仅 `super_admin` 可改（共享命名规则 + 大小写不敏感判重，
  成功后递增 sessionVersion 并写审计）。
- `POST /admin/users/bulk-status`：`{ ids, status }` 批量启停，ids 上限 200；
  逐条套用与单条更新相同的权限规则（不能操作自己、admin 不能操作非 member、
  不能停用最后一位正常最高管理员），返回 `{ updated, skipped }`。
- `POST /auth/breakglass/login`：仅 `hflive_oidc` 且显式开启时接受本地
  `super_admin`。
- `POST /internal/hflive/events`：对原始 JSON body 验证时间窗和 HMAC，按事件 ID
  持久化幂等。`AUTH_MODE=local` 时直接 204 丢弃（外部身份不权威，不产生无效重试）。
- `GET /internal/cron/identity-sync`、`GET /internal/cron/daily`：每日对账入口，
  见「对账与投递语义」。

OIDC 成功后仍只签发 LiveBoard 自己的 7 天 HMAC Cookie。HFLive Auth token、授权码、
PKCE verifier、Cookie 和完整 claims 不写入数据库、审计 metadata 或日志。

## Phase 7 前端行为

登录页始终先读取 `GET /auth/config`，并按服务端实际模式渲染，不使用
`NEXT_PUBLIC_*` 推测认证能力：

- `local`：只显示本地账号密码；
- `hybrid`：HFLive Auth 为主入口，同时保留本地账号密码；
- `hflive_oidc`：普通入口只显示 HFLive Auth；只有服务端明确返回 `breakglass=true`
  时，才在折叠区域显示最高管理员紧急入口。

OIDC 回调遇到用户名或邮箱冲突时，API 将浏览器重定向到 `/login/link`。单次
冲突票据只放在 URL fragment，页面读入内存后立即从地址栏移除；用户必须输入旧
LiveBoard 普通成员账号和密码证明归属，且旧 LiveBoard 用户名规范化后必须与 HFLive Auth
`preferred_username` 一致。该约束同时应用于旧密码自助绑定、已有本地会话绑定和管理员
受控绑定，不能从 API 绕过。密码错误或票据过期后不能重放，必须重新
发起 OIDC。管理员账号不允许走自助合并，系统角色也不会由 HFLive Auth 自动授予。其他
OIDC 回调失败统一返回登录页的可重试错误状态，不向浏览器展示协议内部错误。

个人设置通过 `GET /auth/hflive/account` 获取当前用户自己的安全身份摘要；响应不含
`sub`、token 或 client secret，并使用 `private, no-store`。已关联且外部认证启用时：

- 用户名、邮箱、显示名和头像由 HFLive Auth 管理；显示名与头像在 LiveBoard 只读，入口
  跳转到带受控 `returnTo` 的 `https://auth.hsfz.live/profile`；头像保存成功后在同一标签页返回 LiveBoard 资料页；
- 当前用户和公开个人主页查询都加载并优先使用 `ExternalIdentity.picture`；头像变更事件经 Directory 刷新后，`/app/users/:id` 不会回退到旧本地头像；
- bio、Banner、徽章、打开方式、课堂角色、权限和配额继续由 LiveBoard 管理；
- 服务端同时拒绝绕过界面修改统一显示名或上传本地头像；
- 本地旧账号可从个人设置输入当前密码，发起一次带 `LOCAL_SESSION` intent 的显式
  关联；回调成功后仍使用 LiveBoard 本地会话。

切回 `AUTH_MODE=local` 时，旧本地显示名和头像重新生效，统一身份资料不再作为权威
来源；不会删除映射或 JIT 用户。已绑定用户的头像在外部认证启用时不回退本地历史头像：
HFLive 无头像时显示首字母占位。

## 对账与投递语义

事件只是提示（hint），LiveBoard 必须回拉 Directory 取权威资料。同步有三层自愈路径：

1. **webhook 即时投递**：`processWebhook` 先做事务前校准（ACTIVE 状态事件
   `getStatus`、资料事件 `loadVerifiedProfile`）。校准失败返回 `retryable`
   → 控制器 503 → live_sso outbox 指数退避重试（10 次封顶进死信，管理端可观测）。
   瞬态失败**不写事件行、不更新 `lastStatusEventAt` / `syncState`**，否则重试会被
   eventId 幂等去重或状态事件乱序保护挡掉。终态（applied / duplicate /
   UNKNOWN_SUBJECT / STALE_EVENT / HFLIVE_DISABLED）一律 204。
2. **请求驱动周期刷新**：已关联会话每 15 分钟用 `getProfile` 一次往返同时拿到
   状态与完整资料；ACTIVE 时顺带回写资料（displayName 总是更新，username/email
   仅在无大小写不敏感冲突时更新，冲突标 `PROFILE_CONFLICT`）。即使 webhook 完全
   丢失，活跃用户的资料也会在 15 分钟内自愈。短租约合并并发刷新；最近一次明确
   ACTIVE 不超过 60 分钟时，暂时故障可宽限，之后返回 503。
3. **每日兜底对账 cron**：`GET /internal/cron/identity-sync` 清扫
   `syncState != CURRENT` 或超过 7 天未同步资料的身份，单次上限 30 条，单条失败
   跳过继续；`GET /internal/cron/daily` 顺序执行「存储清理 + 身份对账」，两个
   子任务各自持 Redis 锁。二者都要求 `Authorization: Bearer ${CRON_SECRET}`
   （恒定时间比较）。`apps/api/vercel.json` 的 cron 指向 `/internal/cron/daily`
   （`3 4 * * *`），旧 `/internal/cron/storage-cleanup` 端点保留供自托管/回滚兼容。

Directory client_credentials token 缓存在 Redis（TTL = `expires_in - 60s`），进程内
单飞合并并发请求；Redis 不可用时回退为每次获取。Directory 请求收到 401/403 时清除
缓存并用新 token 重试一次（应对上游轮换）。

## 本地验证

先启动 PostgreSQL 和 Redis，再运行 `pnpm test:phase6`。该命令会加载仓库本地环境，
使用随机隔离的测试用户验证并发 JIT、webhook 幂等事务和真实 Redis `GETDEL` 单次消费，
并在结束时清理测试数据；不得用仅通过 mock 的单元测试替代这组持久化验证。

Phase 7 还必须运行 Web/API 定向测试、仓库级 `pnpm typecheck`、`pnpm test` 和
`pnpm build`，并在真实 `hybrid` 配置下用已关联账号检查登录页、冲突页和个人设置。
浏览器最低覆盖 1280×720 与 390×844、键盘焦点、错误/过期状态、16px 移动输入字号
和页面横向溢出。

API 构建必须在产物中保留字面量 `import("openid-client")`。该包仅提供 ESM，
因此 API 使用 Node16 module emit，在继续输出 CommonJS 的同时保留原生动态导入，
让 Vercel 的依赖追踪把它收进 Serverless 函数。`pnpm --filter @liveboard/api build`
会执行产物检查；不得改回 `new Function`、`eval` 或编译为 `require()`。

## 发布、迁移与回滚

1. 先备份 PostgreSQL，并检查 `lower(trim(username))` 是否重复。
2. 确认至少一个正常的本地 `super_admin` 密码可用。
3. 运行 `prisma migrate deploy`；Phase 6 migration 只新增字段、表、enum、索引和外键。
4. 先以 `AUTH_MODE=local` 部署并回归旧登录，再配置 secret 和稳定 URL。
5. 官方实例切到 `hybrid` 验收 OIDC、JIT、冲突关联、Directory 和 webhook；用户迁移
   完成前不要切到 `hflive_oidc`。

首选回滚是 `hflive_oidc -> hybrid -> local`。回滚前保留原 `SESSION_SECRET`，不要
删除 `ExternalIdentity`、JIT 用户、事件或业务关系，也不要执行 down migration。
JIT 用户仍有有效的随机 Argon2 哈希，但 `localPasswordEnabled=false`，旧代码只会安全
拒绝其本地密码。

## 状态语义

本地 `User.status` 与 HFLive Auth 全局状态做 AND 判断。已关联会话每 15 分钟刷新一次
Directory 状态与资料（`getProfile` 单次往返）。最近一次明确 ACTIVE 不超过 60 分钟时，
暂时的网络/5xx/服务凭据故障可宽限，之后返回 503。DISABLED、Directory 404 或签名
DISABLED webhook 会递增 `sessionVersion` 并撤销旧 Cookie；HFLive Auth 恢复 ACTIVE
永远不会覆盖 LiveBoard 管理员设置的本地 disabled。

管理端成员列表携带 `hflive` 身份摘要（绑定状态、syncState、externalStatus、
linkMethod、最近同步时间），支持「统一身份」列与筛选；编辑弹窗按字段所有权分区：
统一字段只读并链接到 `profileUrl`，管理员只操作角色/状态/AI 限额/标签，支持
「立即同步」与 `super_admin` 改名。`AUTH_MODE=hflive_oidc` 时隐藏「创建成员」与
「批量导入」入口（JIT 成为唯一创建路径）。
