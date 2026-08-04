# 服务器之间迁移（server → server）

把一台自托管服务器（PostgreSQL 业务数据 + 全部文件对象）整体打包，导入另一台
自托管服务器。源服务器**全程只读、不删除任何数据**，迁移失败可随时回滚到源。

> 正式切换前必须按 §5 在测试环境完整演练一次。

## 1. 适用场景与前提

- 换服务器、机房搬迁、测试环境 → 生产环境。
- **两台服务器必须运行同一发布版本**：导入前置校验要求迁移包的 `appVersion` 与
  目标完全一致，且 `prisma/migrations` 目录逐条比对名称与 checksum（不一致直接
  拒绝导入）。升级或迁移前请把两侧对齐到同一版本。
- 目标服务器已挂载迁移数据目录（docker-compose 的
  `/opt/liveboard/migration`，容器内 `/data/migration`）且 API 进程可写；否则
  后台会提示「迁移数据目录不可用」。
- 目标存储后端必须是 MinIO 或 R2（凭据来自环境变量）。**OSS 暂不支持**：OSS
  凭据存在会被清空的目标数据库里，没有环境变量可读，脚本会明确报错。若目标是
  OSS，请先以 MinIO 完成导入，再在管理端手工切到 OSS。
- 源/目标存储无需互通：对象打包进迁移包，随包传输。

## 2. 方式一：后台按钮（推荐）

两台服务器都起好后台后，全程在浏览器操作。

### 2.1 源服务器导出

1. 登录源服务器后台 → **系统与服务 → 数据迁移**。
2. 点 **「开始导出迁移包」**。导出期间站点自动进入只读维护模式，完成后恢复；
   源数据全程不变。
3. 等任务状态变为 **成功**，记下迁移包文件名（形如
   `liveboard-migration-c8h3f...tar`，即迁移任务 ID）。

> 按钮默认把对象打进包（server→server 标准形态）。若源服务器配置了
> `TARGET_R2_*`，会多出一个「对象直推目标 R2」开关，那是 **server→vercel**
> 方向用的，本场景不要勾选。

### 2.2 取包并送到目标

大包（含视频）请从服务器目录直接取，不要走浏览器下载：

```bash
# 源服务器下载到管理员电脑
scp user@SOURCE:/opt/liveboard/migration/exports/<包名>.tar .

# 再放到目标服务器 incoming 目录
scp <包名>.tar user@TARGET:/opt/liveboard/migration/incoming/
```

### 2.3 目标服务器导入

1. 登录目标服务器后台 → **数据迁移**。
2. 在「选择迁移包」中选中刚放入的包。
3. 输入页面显示的确认语，点 **「清空并导入」**。

> ⚠️ 导入会**彻底清空目标服务器全部数据且不做自动备份**。请确认这是目标服务器、
> 目标数据可以放弃后再执行。目标如有不可再生的数据，请自行提前手动备份。

4. 等任务全部成功。完成后所有用户需**重新登录**（会话不迁移，属正常现象）。

### 2.4 结果核对

- 任务列表两条记录（导出 + 导入）均为成功，无红色报错。
- 抽查目标：登录新服务器，课堂/文档/论坛/文件/头像均正常；文件能下载、图片能显示。
- 可在目标服务器后台「数据迁移」用同一个包再跑一次 `migrate-verify` 类校验（按钮
  流程已内嵌校验，成功即视为通过）。

## 3. 方式二：命令行（无后台 / 自动化）

在服务器源码目录（安装器部署的 release）里执行。脚本读取环境变量：
`DIRECT_DATABASE_URL`（优先）或 `DATABASE_URL`、`MIGRATION_DATA_DIR`、
`MINIO_*`/`R2_*` 等；pg_dump/pg_restore 需在 PATH 上（Docker 部署用
`postgresql16-client` 镜像内含）。

```bash
# 源服务器：导出（对象打进包）
pnpm --filter @liveboard/api migrate-export -- --job-id export-1 --concurrency 4

# 目标服务器：导入（清空目标库后还原；先手动把包放进 incoming/）
pnpm --filter @liveboard/api migrate-import -- \
  --job-id import-1 \
  --source /data/migration/incoming/<包名>.tar \
  --confirm CONFIRM-IMPORT \
  --target-backend minio \
  --concurrency 4

# 目标服务器：独立复核（可选）
pnpm --filter @liveboard/api migrate-verify -- --source /data/migration/incoming/<包名>.tar
```

- `--confirm` 必须与目标环境的确认语一致（默认 `CONFIRM-IMPORT`，可用环境变量
  `MIGRATION_IMPORT_CONFIRM_PHRASE` 覆盖）。
- `--target-backend` 必须是目标当前激活后端（minio / r2），导入后会写入还原库的
  `StorageSettings`；传错会在后端构造阶段报错。
- 两个脚本都支持中断重跑：已写入且大小一致的对象自动跳过，dump 重新生成。

## 4. 命令说明

`migrate-export` 与 `migrate-import` 是实际执行者，直接调 `tsx` 亦可：

```bash
cd apps/api
tsx scripts/migrate-export.ts --job-id export-1 [--out 目录] [--no-objects|--push-r2]
tsx scripts/migrate-import.ts --job-id import-1 --source <包或目录> --confirm CONFIRM-IMPORT \
  [--target-backend minio|oss|r2] [--finalize-objects|--pull-source-r2] [--concurrency 4]
```

| 标志                 | 用途                                | 方向                          |
| -------------------- | ----------------------------------- | ----------------------------- |
| `--no-objects`       | 只记对象清单，不打进包              | vercel→server / vercel→vercel |
| `--push-r2`          | 对象直推目标 R2，包内不含对象       | server→vercel                 |
| `--finalize-objects` | 目标端只做"stat + backend 翻转"收尾 | server→vercel                 |
| `--pull-source-r2`   | 对象从源 R2 直拉进目标后端          | vercel→server / vercel→vercel |

## 5. 演练清单

正式迁移前在测试环境完整跑一遍，记录各阶段耗时：

1. 源服务器导出，记录 dump 大小与对象数。
2. 传输包，记录耗时。
3. 目标服务器导入，记录「清空 / 还原 / 标记历史 / 抹密钥 / 写对象 / 校验」各阶段。
4. 校验全部 PASS（行数、孤立外键、最高管理员、缺失对象=0、backend 全为目标后端、
   migration 一致、密钥已清空）。
5. 目标环境登录、抽检文件与图片。

## 6. 回滚规则

- 源部署全程只读不删；目标验证失败即停止，恢复源入口。
- 不把目标产生的新写入反向合并回源。
- 目标导入成功后可清理 `incoming/` 中的迁移包（清理前二次确认）。

## 7. 迁移数据目录

| 位置     | 宿主机                                      | 容器                        |
| -------- | ------------------------------------------- | --------------------------- |
| 导出包   | `/opt/liveboard/migration/exports/`         | `/data/migration/exports/`  |
| 导入输入 | `/opt/liveboard/migration/incoming/`        | `/data/migration/incoming/` |
| 任务状态 | `/opt/liveboard/migration/jobs/`            | `/data/migration/jobs/`     |
| 维护模式 | `/opt/liveboard/migration/maintenance.json` | 同上                        |

本地开发可用环境变量 `MIGRATION_DATA_DIR` 指到任意可写目录；docker-compose 用
`LIVEBOARD_MIGRATION_HOST_DIR` 覆盖宿主目录。
