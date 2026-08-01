# 从自托管迁移数据与对象到 Vercel + Cloudflare R2

本文是把既有自托管 LiveBoard 的 PostgreSQL 业务数据与 MinIO/OSS 对象迁移
到 Vercel 环境的操作手册。旧数据库和旧对象存储保持不动，作为可回滚来源。

> 正式切换前必须演练一次完整流程，记录备份、恢复、对象复制和验证耗时。

## 1. 目标与原则

- 新建干净的目标 PostgreSQL，恢复全部有效业务数据，但不恢复旧
  `_prisma_migrations` 历史。
- 目标数据库只标记唯一 `00000000000000_baseline_v1`，`_prisma_migrations`
  只有一行。
- 把数据库引用的 MinIO/OSS 对象逐对象复制到 R2；单个对象验证成功后才把
  对应记录的 `storageBackend` 改为 `r2`，禁止提前批量 UPDATE。
- 不运行 `migrate reset`、`db push`、`bootstrap-production.ts` 或 `seed.cjs`。
- 不迁移 `PendingUpload` 和 `ServerMetricSample` 数据（短期技术状态）。

## 2. 前置条件

- 旧系统进入维护模式并停止一切写入。
- 生成最终快照前确认旧数据库所有 migration 已应用且无 drift。
- 准备 Vercel 目标环境（见 [deploy-vercel-r2.md](./deploy-vercel-r2.md)）。

## 3. PostgreSQL 备份与恢复

使用 PostgreSQL custom-format 完整备份，让表、数据、约束和 Prisma schema
无法表达的数据库结构一起进入新数据库：

备份必须排除以下表的数据，但保留表结构。不要省略下面三个
`--exclude-table-data` 参数：

```bash
pg_dump -Fc \
  --exclude-table-data='"_prisma_migrations"' \
  --exclude-table-data='"PendingUpload"' \
  --exclude-table-data='"ServerMetricSample"' \
  -f liveboard-backup.dump \
  "旧数据库URL"
```

排除的数据为：

- `_prisma_migrations`：不能把旧 41 条 migration 历史带入目标库。
- `PendingUpload`：短期上传预留，不属于业务数据。
- `ServerMetricSample`：旧宿主机运行指标对 Vercel 无意义。

恢复前可用以下命令确认 dump 中这三张表没有数据项（`TABLE DATA`），但表结构
仍然存在：

```bash
pg_restore --list liveboard-backup.dump | \
  grep -E 'TABLE DATA .* (_prisma_migrations|PendingUpload|ServerMetricSample) '
```

该命令必须没有输出；如果有输出，不要继续恢复，重新生成备份。

恢复到全新、空的目标 PostgreSQL：

```bash
pg_restore --no-owner --no-privileges --exit-on-error \
  -d "新数据库URL" liveboard-backup.dump
```

任何恢复错误立即终止，不允许忽略错误后继续部署。

## 4. 离线升级到最终 schema

完整 dump 恢复后，目标数据库仍是旧应用的最终结构。使用 `prisma migrate diff`
比较目标数据库与最终 `schema.prisma`，生成差异 SQL：

```bash
cd apps/api
pnpm exec prisma migrate diff \
  --from-url "新数据库URL" \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/offline-upgrade.sql
```

人工审查差异 SQL 后，通过 `prisma db execute` 对目标数据库执行。该 SQL 只
用于一次性数据搬迁，不进入最终 migration 历史。升级完成后再次执行 diff，
结果必须为空。

## 5. 对象迁移到 R2

使用对象迁移工具：

```bash
pnpm --filter @liveboard/api migrate-storage-to-r2 -- --dry-run
pnpm --filter @liveboard/api migrate-storage-to-r2 -- --execute --concurrency 4
```

参数：

- `--dry-run`（默认）：只统计与校验，不写入。
- `--execute`：实际复制对象并逐行切换 `storageBackend=r2`。
- `--type avatar,banner,favicon,file_asset,classroom_file`：按类型过滤。
- `--limit N`：限制处理数量。
- `--concurrency N`：并发数（默认 4）。

工具覆盖头像、Banner、三种 favicon、`FileAsset`、`ClassroomFile`，使用相同
`storageKey` 流式复制，复制后对 R2 stat 校验存在与大小，单对象验证成功后
才更新该行 backend。日志不包含 Secret、签名 URL 或用户隐私内容。

先预复制增量（旧系统仍运行），再在维护窗口复制收尾。

## 6. StorageSettings 清理

所有对象验证完成后，清空目标数据库 `StorageSettings` 中遗留的 OSS
Access Key、加密 Secret、Endpoint 与相关标志，把有效 backend/mode 调整为
R2/direct。实际 R2 凭据仍只来自 Vercel 环境变量。

## 7. 标记唯一 baseline

目标数据库已经通过 dump 恢复和离线升级获得最终结构，因此不能再次执行
baseline 建表 SQL：

```bash
pnpm --filter @liveboard/api exec prisma migrate resolve \
  --applied 00000000000000_baseline_v1
```

完成后验证：

- `_prisma_migrations` 只有一条成功的 baseline 记录。
- `prisma migrate status` 无 pending migration。
- 数据库实际结构与最终 `schema.prisma` 无 drift。
- 在另一个全新测试数据库执行 `prisma migrate deploy`，单个 baseline 能从
  零创建完整 schema。

## 8. 迁移验证

```bash
pnpm --filter @liveboard/api verify-vercel-data-migration
```

验证项：

- 关键业务表源/目标行数一致（设置 `SOURCE_DATABASE_URL`）。
- 关键外键无孤立引用。
- 至少存在一名正常最高管理员。
- AI Provider 配置能用 Production `AI_ENCRYPTION_KEY` 解密。
- 所有非空存储引用在 R2 存在且大小正确。
- 所有已迁移对象记录的 backend 为 r2。
- R2 缺失对象数为 0，否则阻断上线。
- `_prisma_migrations` 只有唯一 baseline。

## 9. 正式切换与回滚

切换顺序：维护模式 → 停止写入 → 最终 dump → 恢复 → 离线升级 → 对象迁移
→ StorageSettings 清理 → 标记 baseline → 完整验证 → 部署 Vercel Production
→ 验收后恢复访问。

回滚规则：

- 旧数据库、旧 MinIO/OSS 和旧自托管版本保持只读且不删除。
- Vercel 验证失败时停止 Vercel 流量，恢复旧自托管入口。
- 不把 Vercel 产生的新写入反向合并到旧系统。
- 旧环境的最终删除是独立的后续任务，不属于本次切换。

## 10. 既有自托管数据库的升级路径

仓库改为单 baseline 后，既有自托管数据库（仍保存旧 41 条 history）必须先
经过受控过渡脚本，不能直接运行普通 `migrate deploy`。Release 安装器在
数据库备份后、正常 `migrate deploy` 前调用：

```bash
DATABASE_URL=<url> sh scripts/legacy-baseline-transition.sh            # 只检查
DATABASE_URL=<url> sh scripts/legacy-baseline-transition.sh --execute   # 执行
```

脚本先校验 `_prisma_migrations` 精确匹配已知历史且全部成功完成（名称 +
checksum）；执行桥接 SQL 后还会运行 `prisma migrate diff --exit-code`，确认实际
数据库与最终 schema 完全一致才允许 resolve baseline。未知 migration、失败
记录、checksum 不符、数量不符或 schema drift 一律 fail closed。执行前必须
已有数据库备份。既有数据库可以保留旧 41 条审计记录并新增 baseline 标记。
