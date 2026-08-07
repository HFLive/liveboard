# 备份与回滚设计

后台「备份与回滚」页（`/app/admin/backup`，super_admin）提供：

- **自动备份**：按间隔调度（预设 6h/12h/每天/每周，或自定义 60–10080 分钟），
  超时自动补跑（tick 驱动，以 `lastAutoBackupAt` 为唯一依据）。
- **手动备份**：一键立即备份；回滚前自动创建「保护备份」（manual 级）。
- **回滚**：从某个备份恢复数据库（+可选文件对象），需输入确认语；回滚前
  强制先做一次保护备份。
- **保留份数**：自动 / 手动分别限额（默认 7 / 20），超限自动删除最旧备份；
  被运行中回滚引用的备份跳过。

## 备份内容

| 平台 | 数据库 | 文件对象（可配置开关） |
|---|---|---|
| self_hosted | `pg_dump -Fc` → `backups/<jobId>/database.dump` | 按 DB 引用枚举对象 → `backups/<jobId>/objects/` |
| vercel | Neon 数据分支（无 compute endpoint） | R2 copyObject → `backup/<jobId>/<storageKey>` |

dump 排除表：`PendingUpload`（短期上传预留）、`ServerMetricSample`（宿主指标）。
**`_prisma_migrations` 必须保留**（同库回滚后迁移历史一致，migrate deploy 不会
重复建表）——与迁移导出（搬家）排除它相反。

## 目录与状态文件

```
/data/migration/            （docker-compose 挂载 /opt/liveboard/migration）
├── backups/<jobId>/        database.dump + objects/ + manifest.json
├── backup-jobs/<jobId>.json  任务状态（与迁移的 jobs/ 隔离，互斥扫描双目录）
└── jobs/                   迁移任务状态（既有）
```

任务进度写状态文件（`migration-job-file.ts` 协议，kind 扩展
`auto_backup|manual_backup|restore`）；DB 行 `BackupJob` 在回滚腾空窗口期间
不可靠，完成后 upsert 回表（与 MigrationJob 同模式）。

## 调度（双轨）

- self_hosted：`BackupService.onApplicationBootstrap` 起
  `setInterval(tick, 60s).unref()`；`tick()` 判定
  `shouldRunAutoBackup(settings, now)`。
- vercel：`vercel.json` crons 打 `GET /internal/cron/backup`（Bearer
  `CRON_SECRET` + Redis NX 锁 `liveboard:cron:backup-tick`）→ 同一 `tick()`；
  由 executor 分块推进任务（每 tick ≤20 个对象，保证函数在 60s 内完成）。
  Vercel Hobby 计划 cron 最小每日一次，比用户设置频率粗时后台页面提示。

## 执行器

### self_hosted：`scripts/backup-run.ts` / `scripts/backup-restore.ts`

由 `BackupService.spawnScript`（`spawn(tsx, ...)`，与 migration.service 同模式）
驱动，任务互斥：内存锁 + 文件级双目录扫描（`jobs/` + `backup-jobs/`），
stale TTL 兜底（pending 2min / running 6h）。

回滚顺序（`backup-restore.ts`）：
前置校验（确认语、manifest、formatVersion）→ 维护模式（maintenance.json，
preExisting 语义）→ `DROP SCHEMA CASCADE` → `pg_restore --single-transaction`
→ `prisma migrate deploy`（备份点后升级过则补齐 schema）→ 可选对象回拷
（按还原后 DB 引用的 storageBackend 选后端，大小一致跳过）→ 表行数对账 +
super_admin 存在 → 关维护。**DROP 之后失败保持维护模式**（不允许半还原状态
暴露给写流量）。

### vercel：`backup-vercel-executor.ts` 分块状态机

```
备份：create-branch → wait operation → copy-objects（每 tick ≤20）→ finalize
回滚：restore（主分支 ← 备份分支，preserve_under_name）→ wait → verify →
      R2 回拷 → cleanup（删 Neon 保存的旧主分支）
```

- 进度双写：`BackupJob.progress` + Redis `liveboard:backup:job:<id>`（TTL 7d），
  回滚替换主库期间 UI 从 Redis 读。
- per-job Redis NX 锁防多实例双推进；阶段幂等（对象大小一致跳过）。
- 回滚链：`POST /admin/backup/:id/restore` 创建 manual 保护备份行 + restore
  行；保护备份 finalize 后 `wakePendingRestores` 唤醒 restore。
- 保留策略：`DELETE /projects/{id}/branches/{neonBranchId}` + R2 前缀对象
  逐个 `removeObject`（后端接口无 listObjects，靠 manifest 记录）。
- Neon 分支上限保守默认 auto 3 / manual 5（Free 计划 10 分支/项目），
  `getInfo.vercelLimits` 返回给前端展示。

## 关键端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/backup/info` | 平台能力、设置、确认语、预设、Vercel 分支上限 |
| PATCH | `/admin/backup/settings` | 保存设置（校验间隔 60–10080、保留 1–100） |
| GET | `/admin/backup/jobs[/:id]` | 任务列表/详情；回滚窗口降级为状态文件读取 |
| POST | `/admin/backup/run` | 手动备份 |
| POST | `/admin/backup/:id/restore` | 回滚（confirm 必填）→ `{ preBackup, restore }` |
| POST | `/admin/backup/jobs/:id/dismiss` | 清除失败报错 |
| GET | `/internal/cron/backup` | Vercel 调度入口（CRON_SECRET） |

全部写端点 `requireSuperAdmin`；Vercel 未配 `NEON_API_KEY`/`NEON_PROJECT_ID`
时 503。

## 安全与边界

1. **回滚前保护备份**：restore 端点先建 manual 保护备份，成功后才启动回滚；
   链由互斥锁覆盖全程，期间任何新任务 409。
2. **链中断兜底**：restore 行 pending 超 2min 且无状态文件（服务重启）
   → tick 落 failed「可重新发起」，不自动恢复（显式确认的稀有操作）。
3. **互斥**：备份 ↔ 回滚 ↔ 迁移导入/导出（双目录扫描，migration.service
   同步扩展）。
4. **BigInt 序列化**：`dumpSizeBytes` 在 DTO 映射必须 `String()`。
5. **回滚后列表变化**：DB 还原到备份点，「备份点之后创建的备份行」消失，
   属预期语义（页面有说明）。
6. **部署脚本备份独立**：`deploy-bundle.sh` 的宿主级备份（`$STATE_DIR/backups/`）
   与应用内备份（`/data/migration/backups/`）互不影响。
7. **AI 密钥**：`AI_ENCRYPTION_KEY` 在 `.env`，备份/回滚不改它，加密数据
   可正常解密；Vercel 迁移已有约定要求该密钥独立安全备份。
