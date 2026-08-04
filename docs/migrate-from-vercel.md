# 从 Vercel 迁出（vercel → server / vercel → vercel）

把 Vercel + Cloudflare R2 上的 LiveBoard 迁到自托管服务器（vercel → server），
或迁到另一套 Vercel + R2（vercel → vercel）。Vercel 无法执行后台按钮导入，
所有操作由管理员电脑（或目标服务器）跑 `migrate-*` 脚本完成。

> 正式切换前必须按 §5 在测试环境完整演练。

## 1. 前置条件

- 源 Vercel 与目标应用的版本**完全一致**。
- 源 Vercel 的 PostgreSQL **公网直连串**（`DIRECT_DATABASE_URL`）与 R2 凭据。
- 目标环境已准备：自托管服务器（挂载迁移目录，MinIO/R2 可写）或另一套 Vercel+R2。
- 管理员电脑有 `node` + `apps/api` 源码与 `pg_dump`/`pg_restore`。

## 2. 一次性交接源 R2 凭据

`SOURCE_R2_*` 只用于本次迁移，用后即删：

| 变量 | 含义 |
| ---- | ---- |
| `SOURCE_R2_ACCOUNT_ID` / `SOURCE_R2_BUCKET` | 源 R2 账号与 Bucket |
| `SOURCE_R2_ACCESS_KEY_ID` / `SOURCE_R2_SECRET_ACCESS_KEY` | 源 R2 API Token |
| `SOURCE_R2_ENDPOINT`（可选） | R2 兼容网关才需覆盖 |

## 3. vercel → server

### 3.1 管理员电脑导出（对象留在源 R2，只记清单）

```bash
cd apps/api

DIRECT_DATABASE_URL="postgresql://<user>:<pass>@<host>:5432/<db>?sslmode=require" \
R2_ACCOUNT_ID=<源id> R2_BUCKET=<源bucket> \
R2_ACCESS_KEY_ID=<key> R2_SECRET_ACCESS_KEY=<secret> \
tsx scripts/migrate-export.ts --job-id from-vercel --no-objects --concurrency 4
```

- `--no-objects`：对象**不打进包**，仍留在源 R2；manifest 记录每个对象的
  `storageKey` 与大小，供目标端校验。
- 也可以只给 `SOURCE_R2_*` 不给 `R2_*`，脚本会优先读 `SOURCE_R2_*`。

导出包输出到 `MIGRATION_DATA_DIR/exports/<包名>.tar`（默认
`/data/migration/exports`，管理员电脑上可能不可写）。建议显式指定：
`MIGRATION_DATA_DIR=/tmp/vercel-export` 或加 `--out /tmp/vercel-export`。

### 3.2 传包到目标服务器

```bash
scp /tmp/vercel-export/<包名>.tar user@TARGET:/opt/liveboard/migration/incoming/
```

### 3.3 目标服务器导入（从源 R2 直拉）

在目标服务器上配置一次性 `SOURCE_R2_*` 后执行：

```bash
# 目标服务器源码目录
SOURCE_R2_ACCOUNT_ID=<源id> SOURCE_R2_BUCKET=<源bucket> \
SOURCE_R2_ACCESS_KEY_ID=<key> SOURCE_R2_SECRET_ACCESS_KEY=<secret> \
pnpm --filter @liveboard/api migrate-import -- \
  --job-id pull-1 \
  --source /data/migration/incoming/<包名>.tar \
  --confirm CONFIRM-IMPORT \
  --target-backend minio \
  --pull-source-r2 \
  --concurrency 4
```

脚本先清空目标库并还原 dump，然后**逐对象从源 R2 拉进目标 MinIO**，stat 校验
大小后翻转 `storageBackend=minio`，最后完整校验。

> `--target-backend` 传目标服务器激活后端（minio / r2）。拉取完成后删除目标上的
> `SOURCE_R2_*`。

## 4. vercel → vercel（R2 → R2）

### 4.1 导出（同 §3.1）

用源 Vercel 的直连串 + R2 凭据导出 `--no-objects`。

### 4.2 管理员电脑 R2→R2 直拉

同时持有源/目标两套 R2 凭据（`SOURCE_R2_*` / `TARGET_R2_*`），把对象从源 R2
复制进目标 R2：

```bash
cd apps/api

DIRECT_DATABASE_URL="postgresql://<target-user>:<pass>@<target-host>:5432/<db>?sslmode=require" \
SOURCE_R2_ACCOUNT_ID=<源id> SOURCE_R2_BUCKET=<源bucket> \
SOURCE_R2_ACCESS_KEY_ID=<key> SOURCE_R2_SECRET_ACCESS_KEY=<secret> \
TARGET_R2_ACCOUNT_ID=<目标id> TARGET_R2_BUCKET=<目标bucket> \
TARGET_R2_ACCESS_KEY_ID=<key> TARGET_R2_SECRET_ACCESS_KEY=<secret> \
tsx scripts/migrate-import.ts \
  --job-id r2r2-1 \
  --source ./<包名>.tar \
  --confirm CONFIRM-IMPORT \
  --target-backend r2 \
  --pull-source-r2 \
  --concurrency 4
```

`--target-backend r2` 让目标后端与 `TARGET_R2_*` 一致；对象从 `SOURCE_R2_*`
读、写进 `TARGET_R2_*`，逐对象校验后翻转 `storageBackend=r2`。

## 5. 演练清单与验收

1. 导出：确认对象清单数量与 dump 大小。
2. 导入/直拉：确认 `[verify] 全部校验通过`，缺失对象=0，backend 全为目标后端。
3. 抽检：目标环境登录，课堂/文档/论坛/文件/头像正常。
4. 清理：一次性交接的 `SOURCE_R2_*` / `TARGET_R2_*` 用后即删。

## 6. 回滚规则

- 源 Vercel 全程只读不删；目标验收失败即停止。
- 不把目标产生的新写入反向合并回源。
- 直拉/复制进目标存储的对象在放弃时不会自动清理，可重新导入覆盖或手工删除。
