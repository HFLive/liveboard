# 从自托管迁移到 Vercel + Cloudflare R2（server → vercel）

把自托管服务器的 PostgreSQL 业务数据与 MinIO/OSS 对象整体搬到 Vercel + R2。
推荐「对象直推 R2」：源服务器把对象直接推送到目标 R2（避免大文件先下载再上传），
数据库 dump 随迁移包经管理员电脑搬运。

> 本手册是对既有 [migrate-data-to-vercel-r2.md](./migrate-data-to-vercel-r2.md)
> 的**一键化替代**：用统一的迁移包 + `migrate-*` 脚本完成，不再手工执行
> pg_dump/pg_restore/离线升级/逐对象迁移。旧手册的 §10「既有自托管数据库升级路径」
> 仍适用于**还停留在旧 migration 历史的自托管库**（先跑
> `legacy-baseline-transition.sh` 再升级）。
>
> 正式切换前必须按 §6 在测试环境完整演练。

## 1. 前置条件

- 源自托管服务器版本与 Vercel 目标版本**完全一致**（`appVersion` 与 migration
  checksum 逐条比对，不一致拒绝导入）。
- Vercel 目标已按 [deploy-vercel-r2.md](./deploy-vercel-r2.md) 准备好：PostgreSQL
  直连串、R2 凭据已配置为环境变量（`R2_ACCOUNT_ID` 等）。
- 源服务器能访问目标 R2（公网可达）；否则用 §5 的「离线包」替代直推。
- 管理员电脑有 `node` 与 `apps/api` 源码（跑收尾命令用），且装有 `pg_restore`（或
  用 [postgresql-client]）。

## 2. 一次性交接目标 R2 凭据

`TARGET_R2_*` 只用于本次迁移，**用后即删**，不写入 `StorageSettings`、不进日志：

| 变量                                                      | 含义                                              |
| --------------------------------------------------------- | ------------------------------------------------- |
| `TARGET_R2_ACCOUNT_ID`                                    | 目标 R2 账号 ID（Cloudflare 仪表盘）              |
| `TARGET_R2_BUCKET`                                        | 目标 R2 Bucket（与 Vercel 应用 `R2_BUCKET` 一致） |
| `TARGET_R2_ACCESS_KEY_ID` / `TARGET_R2_SECRET_ACCESS_KEY` | 目标 R2 API Token                                 |
| `TARGET_R2_ENDPOINT`（可选）                              | R2 兼容网关才需覆盖端点；真实 Cloudflare R2 省略  |

## 3. 源服务器导出（对象直推 R2）

### 方式 A：后台按钮

1. 在源服务器环境变量中临时加上表 `TARGET_R2_*`，重启 API。
2. 登录源服务器后台 → **数据迁移**，勾选 **「对象直推目标 R2」**，点
   **「开始导出迁移包」**。
3. 等任务成功。此刻所有对象已写入目标 R2，包内只有 `database.dump` + `manifest.json`。

### 方式 B：命令行

```bash
# 源服务器源码目录
TARGET_R2_ACCOUNT_ID=<id> TARGET_R2_BUCKET=<bucket> \
TARGET_R2_ACCESS_KEY_ID=<key> TARGET_R2_SECRET_ACCESS_KEY=<secret> \
pnpm --filter @liveboard/api migrate-export -- --job-id to-vercel --push-r2
```

### 取包

```bash
scp user@SOURCE:/opt/liveboard/migration/exports/<包名>.tar .
```

> 迁移完成后删除源服务器的 `TARGET_R2_*`（一次性交接，不留存）。

## 4. 管理员电脑收尾（还原 + finalize + 校验）

目标 Vercel 的 API 无法执行导入（无按钮），由管理员电脑用直连串还原：

```bash
cd apps/api

MIGRATION_DATA_DIR=/tmp/vercel-import \
DIRECT_DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>?sslmode=require" \
TARGET_R2_ACCOUNT_ID=<id> TARGET_R2_BUCKET=<bucket> \
TARGET_R2_ACCESS_KEY_ID=<key> TARGET_R2_SECRET_ACCESS_KEY=<secret> \
tsx scripts/migrate-import.ts \
  --job-id finalize-1 \
  --source ./<包名>.tar \
  --confirm CONFIRM-IMPORT \
  --target-backend r2 \
  --finalize-objects \
  --concurrency 4
```

> 管理员电脑上把 `MIGRATION_DATA_DIR` 指到可写目录（脚本会把 .tar 解压到其中
> 的临时目录，任务结束自动清理）。

这一步依次执行：前置校验（fail-closed）→ 清空目标库 → 还原 dump → 逐条标记
迁移历史 → 抹除 AI/OSS 密钥 → **逐对象 stat 目标 R2 + backend 翻转** → 完整校验。

看到 `[verify] 全部校验通过` 即完成。要点：

- `--target-backend r2` 必须显式给出（还原后目标库被源数据覆盖，不能再读它判断）。
- 对象大小以 manifest 为准：源服务器直推后目标 R2 已有对象，finalize 只做
  「存在 + 大小一致」校验后翻转 `storageBackend=r2`，不做数据写入。
- 中途失败可重跑：已校验通过的对象自动跳过，未翻转的继续翻转。

## 5. 离线包替代方案（源服务器无法直连 R2）

若源服务器无公网出站、不能直推 R2，改走「对象打进包」：

```bash
# 源服务器：普通导出（对象在包内）
pnpm --filter @liveboard/api migrate-export -- --job-id to-vercel-offline

# 管理员电脑：包内对象写入目标 R2（package 模式）
tsx scripts/migrate-import.ts --job-id offline-1 --source ./<包名>.tar \
  --confirm CONFIRM-IMPORT --target-backend r2 --concurrency 4
```

缺点：大文件要先随包到管理员电脑再上传，耗时更长。

## 6. 演练清单与验收

1. 源导出：确认对象数、dump 大小，记录直推耗时。
2. 收尾：确认 `[verify] 全部校验通过`。
3. Vercel 后台用 Production `AI_ENCRYPTION_KEY` 等**重新填入 AI Provider 密钥**
   （迁移会清空 `AiProviderConfig.apiKey`，属预期）。
4. 抽检：登录新 Vercel 环境，课堂/文档/论坛/文件/头像正常，文件可下载、图片可显示。
5. 用 `prisma migrate status` 确认目标库无 pending migration。

## 7. 回滚规则

- 源自托管全程只读不删；Vercel 验收失败即停止，恢复自托管入口。
- 不把 Vercel 产生的新写入反向合并回源。
- 对象已推入目标 R2、但验收放弃时，R2 中对象不会自动清理；可重新导入覆盖或手工清理。

## 8. 迁移过程中遇到的坑与解决方案

以下按实际执行顺序排列。

### 8.1 管理员电脑缺 pg_restore,或版本与目标库不匹配

`migrate-import` 需要本机有 `pg_restore`。没装会报 `spawnSync pg_restore ENOENT`：

```bash
brew install postgresql@16   # 或 brew install libpq；postgresql@16 与目标版本一致更稳
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
pg_restore --version
```

`libpq` 与 `postgresql@16` 都是 keg-only，装完必须手动把 bin 加入 PATH，否则裸命令仍找不到。版本必须与目标库一致：PostgreSQL 17+ 的 `pg_restore` 连接时会默认发送 `SET transaction_timeout = 0`，而 Neon PG16 目标库不认，还原直接失败：

```text
pg_restore: error: could not execute query: ERROR:  unrecognized configuration parameter "transaction_timeout"
```

**必须用与目标库相同大版本（本项目为 16）的 pg_restore，没有命令行开关能关掉这条。**

### 8.2 脚本要用 pnpm exec 运行

`tsx` 是 `apps/api` 的 devDependency，不在全局 PATH，裸跑报 `command not found: tsx`：

```bash
cd apps/api
pnpm exec tsx scripts/migrate-import.ts ...
```

### 8.3 目标库尚未建表：报 `StorageSettings` 不存在

```text
The table `public.StorageSettings` does not exist in the current database.
```

`migrate-import` 在清库前要先读目标库 `StorageSettings`（捕获随后将被清空的 OSS 凭据），要求目标库已有完整 schema。schema 由 Vercel API 构建时的 `prisma migrate deploy` 自动创建；**如果目标 API 还没部署成功，Neon 就是空库**，此步必报错。先手动建 schema 再重跑导入（脚本随后 DROP SCHEMA 重来，预建的 baseline 幂等无害）：

```bash
cd apps/api
DATABASE_URL=<Neon直连> DIRECT_DATABASE_URL=<Neon直连> pnpm db:deploy
```

更稳的路径：按 [deploy-vercel-r2.md](./deploy-vercel-r2.md) 先部署并验收空环境（`/api/health` 的 storage 为 `ok`）再迁数据。若导入用的 `DIRECT_DATABASE_URL` 与 Vercel API 实际连接的是不同 Neon 库（不同项目/分支/库名），也会出现此报错，先对比两边 URL 的主机名与库名。

### 8.4 迁移后存储不可用，头像/favicon 上传报 500

症状：管理端存储页「健康状态：不可用」，`/api/health` 的 `storage` 为 `unavailable`，头像/favicon 上传报 internal server error。头像/favicon 走服务端 `putObject`，与健康检查（HeadBucket）使用同一个 R2 客户端，客户端不可用就全部 500（浏览器直传的预签名 URL 同样由该客户端生成，也会一起失败）。

最常见原因是 **R2 API Token 权限设错**。核对：

- Cloudflare → R2 → Manage R2 API Tokens：Access Key ID 对应 token 仍在、未删除；
- token 作用域是目标 bucket（如 `liveboard-production`），权限为 **Object Read & Write**；
- Vercel 的 `R2_ACCOUNT_ID` 是持有该 bucket 的 Cloudflare 账号 ID。

两个容易误踩的点：

- Cloudflare 的 Secret **只显示一次**，复制进 Vercel 后**不要把 Cloudflare 里的 token 删除**——删除即吊销，即使 Vercel 存着当时的 Secret 也连不上。
- Vercel 环境变量设为「使用后不可见」后无法读回明文；凭据一旦丢失只能新建 token 旋转，不能「再读一次」找回。
