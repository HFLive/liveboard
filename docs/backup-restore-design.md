# 备份与回滚设计

后台「备份与回滚」页（`/app/admin/backup`，super_admin）提供：

- **自动备份**：按间隔调度（预设 6h/12h/每天/每周，或自定义 60–10080 分钟），
  超时自动补跑（tick 驱动，以 `lastAutoBackupAt` 为唯一依据）。
- **手动备份**：一键立即备份。自托管回滚前另建保护备份；Vercel 免费版只
  能保留一个手动 Snapshot，不额外创建第二份。
- **回滚**：从某个备份恢复数据库（+可选文件对象），需输入确认语。
- **保留份数**：自动 / 手动分别限额（默认 7 / 20），超限自动删除最旧备份；
  被运行中回滚引用的备份跳过。

## 备份内容

| 平台        | 数据库                                          | 文件对象（可配置开关）                          |
| ----------- | ----------------------------------------------- | ----------------------------------------------- |
| self_hosted | `pg_dump -Fc` → `backups/<jobId>/database.dump` | 按 DB 引用枚举对象 → `backups/<jobId>/objects/` |
| vercel      | Neon 手动 Snapshot                              | R2 copyObject → `backup/<jobId>/<storageKey>`   |

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
  cron 端点必须带 `@Public()`（ActiveUserGuard 是全局守卫，只认会话 cookie，
  不带标记会在密钥校验前 401 拦截 cron 请求；曾导致线上 tick 从不执行）。
  由 executor 分块推进任务（每 tick ≤20 个对象，保证函数在 60s 内完成）。
  手动备份/回滚链创建后立即在请求内推进到完成（每棒 ≤45s 预算，预算耗尽
  自动接力续跑：函数自调用 `internal/cron/backup?jobId=<id>`（Bearer
  `CRON_SECRET`），每棒一个新函数实例继续推进同一任务，直至完成；本轮
  无进展不接力，接力缺 URL/密钥或断链时由每日 cron 兜底收尾）。自动备份
  由 cron tick 用周期宽窗口判定并创建（cron 每日一次，到点后的任意 tick
  都算窗口内，同周期只跑一次）。
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
备份：create-snapshot → wait operation → copy-objects（每 tick ≤20）→ finalize
回滚：snapshot restore（finalize_restore=true）→ wait → verify →
      R2 回拷 → cleanup（只删 Neon 标记的被替换旧分支）
```

- 进度双写：`BackupJob.progress` + Redis `liveboard:backup:job:<id>`（TTL 7d）。
  回滚替换主库期间 executor 从 Redis 重建被快照抹掉的任务行，管理页仍以
  数据库任务行为展示来源。
- 换库重建：Neon finalized Snapshot restore 会把 compute 切到恢复后的新分支，
  备份点之后创建的回滚行会被快照抹掉。executor 每次推进把行元数据
  （kind、restoreFromId、includeObjects、isProtection）随进度
  写 Redis；行缺失时按 Redis 状态重建（`recoverJobRow`）再继续推进，写入
  一律 upsert（`upsertJobRow`）；restore/objects 阶段先修复源备份行
  （manifest 从 Redis 进度重建、Snapshot id 按 `backup-<id>` 名称找回）。
  每日 cron 的 `advance()`
  兜底扫描 Redis 里的孤儿执行中任务并接力续跑。
- per-job Redis NX 锁 `liveboard:backup:lock:<id>` 防多实例双推进，与进度 key
  严格分离；阶段幂等（对象大小一致时计入完成并跳过复制）。
- Redis 是换库窗口中唯一不随 Neon 快照倒退的状态源：创建任务前确认连接，
  状态或锁写入失败一律 fail closed，不允许在无锁/无恢复状态时继续回滚。
- Vercel 的维护模式同样存 Redis（`liveboard:maintenance:state`），不再恒定
  关闭：发出 Neon restore 前开启，校验、对象回拷和清理全部完成后才关闭；
  读取失败按开启处理。关闭失败时任务保留 running/cleanup 并由下一棒重试。
- Neon 的 Snapshot 创建与恢复响应可能包含多条异步 operations；进度同时保存首条
  `operationId`（兼容旧任务）和完整 `operationIds`，全部 finished 后才进入
  下一阶段。Snapshot 只能从默认根分支创建；检测到旧式非根默认分支时 fail
  closed，要求先迁到新的 Neon 项目，绝不继续制造祖先依赖链。
- Snapshot restore POST 是非幂等操作：调用前先把 `restore/requesting` 意图
  写入 Redis。若网络错误或 20 秒内未返回，只读查询分支的
  `restored_from`/`restored_as` 元数据确认结果，禁止自动重发 POST。
- 启动新任务前同时检查 DB 与 Redis 中的 pending/running 链；Vercel 实例没有
  持久状态文件，不能只依赖本地 `backup-jobs/` 目录做全局互斥。
- 自调用接力端点在 Vercel 上立即返回 accepted，并用官方
  `@vercel/functions` 的 `waitUntil()` 托管本棒推进。调用方 10 秒超时只用于
  覆盖免费实例冷启动并确认端点已接收，不能 abort 一个仍同步等待 20–45 秒
  的处理器；否则链是否
  继续没有平台保证。每次 Vercel 请求结束还必须释放进程内 `runningJobId`
  哨兵，跨实例互斥只由 DB 与 Redis 持续。
- 孤儿 Snapshot 清扫同时核对 DB 行与 Redis 活跃任务；旧版 `backup-*` /
  `pre-restore-*` 分支只保留兼容清理，不再创建。
- Vercel 回滚只创建 restore 行；Neon 自身先保留被替换旧分支，校验成功后仅按
  `restored_as` 返回值删除它。自托管仍创建 manual 保护备份。
- 保留策略：新任务删除 Snapshot + R2 前缀对象；旧任务按 manifest/实际资源
  自动兼容删除分支。对象逐个 `removeObject`（靠 manifest 记录）。
- Neon Free 只允许一个手动 Snapshot：手动备份已有快照时返回 409；自动备份
  只轮换应用自己的上一份成功自动 Snapshot，绝不覆盖手动或未知 Snapshot。
  回滚另需一个瞬态分支空位；`getInfo.vercelLimits` 返回这些限制。

## 关键端点

| 方法  | 路径                             | 说明                                          |
| ----- | -------------------------------- | --------------------------------------------- |
| GET   | `/admin/backup/info`             | 平台能力、设置、确认语、预设、Vercel 免费限额 |
| PATCH | `/admin/backup/settings`         | 保存设置（校验间隔 60–10080、保留 1–100）     |
| GET   | `/admin/backup/jobs[/:id]`       | 任务列表/详情；回滚窗口降级为状态文件读取     |
| POST  | `/admin/backup/run`              | 手动备份                                      |
| POST  | `/admin/backup/:id/restore`      | 回滚；Vercel 返回 `preBackup: null`           |
| POST  | `/admin/backup/jobs/:id/dismiss` | 清除失败报错                                  |
| GET   | `/internal/cron/backup`          | Vercel 调度入口（CRON_SECRET）                |

全部写端点（包括硬删除备份）都在服务层执行 `requireSuperAdmin`；Vercel 未配
`NEON_API_KEY`、`NEON_PROJECT_ID`、`REDIS_URL` 或 `CRON_SECRET` 时 503，
避免创建注定无法跨函数接力或在换库时丢失状态的任务。

## 安全与边界

1. **回滚防线**：自托管先建 manual 保护备份；Vercel finalized Snapshot restore
   保留被替换旧分支，校验成功后才清理。链由互斥锁覆盖，期间新任务 409。
2. **链中断兜底**：self_hosted 的 restore 行 pending 超 2min 且无状态文件
   （服务重启）→ tick 落 failed「可重新发起」；Vercel 由 Redis 进度与
   executor 幂等续跑。
3. **互斥**：备份 ↔ 回滚 ↔ 迁移导入/导出（双目录扫描，migration.service
   同步扩展）。
4. **BigInt 序列化**：`dumpSizeBytes` 在 DTO 映射必须 `String()`。
5. **回滚后列表变化**：DB 还原到备份点，「备份点之后创建的备份行」消失，
   属预期语义（页面有说明）。
6. **部署脚本备份独立**：`deploy-bundle.sh` 的宿主级备份（`$STATE_DIR/backups/`）
   与应用内备份（`/data/migration/backups/`）互不影响。
7. **AI 密钥**：`AI_ENCRYPTION_KEY` 在 `.env`，备份/回滚不改它，加密数据
   可正常解密；Vercel 迁移已有约定要求该密钥独立安全备份。
