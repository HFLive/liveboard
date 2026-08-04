# 任意方向数据迁移设计（迁移包 + 双向工具）

> 状态：**P0–P3 已实现并通过本地端到端实测（2026-08-04）**；P4 操作手册待写。本文定义目标形态与实施拆解。
> 日期：2026-08-04（v2 修订：修复导入顺序、MigrationJob 冲突、版本规则、密钥清理、大包传输等问题）

## 实施进度（2026-08-04）

- **P0 已实现**：runner 镜像加 `postgresql16-client`（`apps/api/Dockerfile`）；`MigrationJob` 模型 + migration `20260804000000_add_migration_job`；docker-compose 挂载 `/opt/liveboard/migration` ↔ `/data/migration`（安装器创建并 chown 1000）；维护/只读模式（`maintenance.json` 状态文件 + `MaintenanceModeGuard` 全局守卫 + `admin/maintenance` 开关 + 前端横幅）。
- **P1 已实现**：引擎 `apps/api/src/modules/migration/`（`collectObjectRefs` 通用化、manifest 类型、导入校验、任务状态文件）；CLI 脚本 `scripts/migrate-export.ts` / `migrate-import.ts` / `migrate-verify.ts`（tsx 移入 dependencies 供按钮 spawn）；`MigrationModule` 端点（export/import/jobs/incoming/upload/download/info）；后台页 `/app/admin/migration`。
- **P2 已实现**（server→vercel 直推 R2 + 收尾）：`migrate-export --push-r2`（对象直推目标 R2，`TARGET_R2_*` 一次性交接，包内不含对象）；`migrate-import --finalize-objects`（目标端"逐对象 stat + backend 翻转"收尾，需显式 `--target-backend r2`）；后台导出按钮增加"对象直推目标 R2"开关（`pushToR2Available` 检测源服务器是否配置 `TARGET_R2_*`）。
- **P3 已实现**（vercel→server / vercel→vercel）：R2 配置双前缀 `SOURCE_R2_*` / `TARGET_R2_*`（回退应用自身 `R2_*`）；`migrate-import --pull-source-r2`（对象从源 R2 直拉进目标后端，R2→R2 复制即 `--pull-source-r2 --target-backend r2`）；vercel 端导出用 `--no-objects`。
- **引擎支撑**：`R2StorageBackend` 支持自定义 endpoint（`*_R2_ENDPOINT` 覆盖，S3 兼容网关/本地 MinIO 联调）+ path-style 寻址；`putObject` 支持显式 `contentLength`（R2/S3 流式上传必需）；`ObjectStorageBackend.putObject` 接口加可选第 4 参；共享 `transferObjectTo`（直推/直拉幂等复制：目标存在且大小一致则跳过）；`scripts/migrate-package.ts` 共享包解压（`migrate-verify` 也支持 `.tar` 输入）。
- **端到端实测**（本地 docker，MinIO 充当 R2 联调）：四方向全部跑通、`migrate-verify` 全绿——server→server（包内对象）、server→vercel（push-r2 + finalize）、vercel→server（no-objects + pull-source-r2 进 minio）、vercel→vercel（pull-source-r2 目标 r2）。实测修复三个真 bug：① `tarBundle` 的 `-f` 相对进程 CWD 导致 tar 写到错误位置（改绝对路径）；② 导入成功但 `process.exitCode` 为 `undefined` 导致维护模式未关闭（`(process.exitCode ?? 0) !== 0` 归一化）；③ AWS SDK 流式上传 MinIO 缺 `Content-Length`（加 `contentLength` 参数）+ 自定义 endpoint 需 path-style 寻址。
- **关键实现决策补充**：导入端目标后端由 API 在腾空前读取 `StorageSettings.backend` 并传 `--target-backend` 给脚本（还原后 DB 会被源数据覆盖，不能再作为依据）；MinIO/R2 目标经环境变量工作；**OSS 目标现受支持**——OSS 凭据存在会被清空的 DB 里，脚本在 DROP 前捕获目标自身 OSS 配置，导入期间用它写入 OSS，还原后原样写回（目标无需重新配置），并在清库前做支持性校验（fail-closed）。
- **P4 已实现**：`docs/migrate-server-to-server.md`（server→server 操作手册，含演练清单与回滚规则）、`docs/migrate-to-vercel-r2.md`（server→vercel 一键向导，替代/引用既有 `migrate-data-to-vercel-r2.md`）、`docs/migrate-from-vercel.md`（vercel→server / vercel→vercel）。
- 待办：重新打包 `.run` 发布包（Dockerfile/compose/安装器改动需重建镜像才能用上 postgresql16-client 与迁移目录挂载）。

## v2 修订说明

相对 v1 的主要变更：

- §7 导入主线重写：明确"腾空目标库（DROP SCHEMA）→ 还原 → 逐条 resolve → 抹密钥 → 对象导入"的完整顺序；v1 的"清空业务数据"未定义且与 pg_restore 冲突。
- 版本策略改为**强制同版本**（fail-closed），跨版本走既有手册的离线升级路径；删除 v1 自相矛盾的"目标 ≥ 源 + checksum 匹配"双规则。
- 给 `MigrationJob` 定了完整规则（dump 排除数据、导入期间用本地状态文件、还原后落库），消除它与"唯一 baseline、无 drift"验证的冲突；`migrate resolve` 改为按包内迁移历史**逐条**执行，而不是只 resolve baseline。
- 密钥清理从"意愿"变成硬性步骤：restore 完成后立即 null 化 `AiProviderConfig.apiKey` 与 `StorageSettings` 凭据；明确包内含加密密文这一事实与风险。
- 大包存储与传输补齐：新增 `/opt/liveboard/migration` 挂载目录，导入以"路径式导入"为主，浏览器上传仅限小包；manifest 增加 `dumpSha256`。
- 其他：对象在包内平铺存储防路径穿越、模型清单改为"除排除清单外全部表"、维护模式口径统一、补 Redis/会话说明、pg client 版本约束、Neon 直连 URL 引用。

## 1. 目标与范围

把 LiveBoard 的数据从一套部署迁移到另一套部署，四方向全覆盖：

| 源 → 目标 | 形态 |
| --------- | ---- |
| server → server | 自建服务器（MinIO / 阿里云 OSS）→ 自建服务器 |
| server → vercel | 自建服务器 → Vercel（Cloudflare R2 + 托管 PostgreSQL） |
| vercel → server | Vercel → 自建服务器 |
| vercel → vercel | Vercel → 另一套 Vercel |

设计目标：

- **最高管理员**从网站后台一键导出/导入，或使用等价命令行工具；全程不依赖两台部署之间网络互通，通过"迁移包 + 管理员电脑/任一台服务器中转"完成。
- **迁移包**是唯一传输载体：`manifest.json` + `database.dump` + （按方向决定是否包含）`objects/`。
- 源部署在迁移全程**保持不动**，作为可回滚来源；成功后由管理员自行决定何时下线。
- 文件"搬动"遵循规则：**由离目标近、网络通的那台机器执行**（服务器或管理员电脑），Vercel 无服务器侧**不新增任何迁移代码**。

范围边界：

- 只迁移业务数据。`PendingUpload`、`ServerMetricSample`、`MigrationJob`（数据）不迁移（短期技术状态/任务记录）。
- 数据库环境相关密钥（OSS AccessKeySecret、AI apiKey）不随包生效：dump 物理上会包含其加密密文，导入器在还原后**第一步即全部抹除**，目标端重新填写。
- 一期实现 server 源 / server 目标两端的后台按钮；涉及 Vercel 的方向用等价命令行工具 + 向导补齐。
- **版本策略：一期强制源与目标应用版本完全一致**（fail-closed）。跨版本迁移不在导入器职责内，需先升级其中一侧到同版本，或对 dump 执行 `docs/migrate-data-to-vercel-r2.md` §4 的离线升级流程后再导入。

## 2. 背景：数据分布

业务数据存在两个地方：

1. **PostgreSQL**（Prisma 管理，`apps/api/prisma/schema.prisma`）：全部业务记录，主键为 `cuid`，跨环境可移植。**迁移范围 = 除排除清单外的全部表**（以 `schema.prisma` 当前定义为准，不做人工枚举，避免漏表）。主要模型包括：
   - 课堂：`Classroom`、`ClassroomMember`、`ClassroomFile`、`ClassroomAnnouncement`
   - 文档：`Folder`、`File`、`ContentBlock`、`FileAsset`、`PermissionGrant`
   - 练习：`ExerciseSet`、`Question`、`Submission`、`SubmissionAnswer`
   - 课件：`TeachingDeck`、`TeachingDeckItem`
   - 论坛：`ForumCategory`、`ForumThread`、`ForumPost`、`ForumPostVote`
   - 用户/元数据：`User`、`UserTag`、`UserTagAssignment`、`Badge`、`UserBadge`、`Notification`、`NotificationRecipient`、`Workspace`、`AiSettings`、`AiProviderConfig`、`AiConversation`、`AiMessage`、`StorageSettings`
   - 排除（保留表结构、不迁数据）：`_prisma_migrations`（目标按 §7.4 重建标记）、`PendingUpload`（上传预留）、`ServerMetricSample`（宿主运行指标）、`MigrationJob`（迁移任务记录，见 §5.3）

2. **对象存储**（MinIO / 阿里云 OSS / Cloudflare R2，可混用）：二进制文件只以 `storageKey` 字符串存于 DB，对应 5 类对象，且**每行记录自带 `storageBackend` 字段**：

   | 来源表/字段 | kind |
   | ----------- | ---- |
   | `User.avatarStorageKey` | avatar |
   | `User.bannerStorageKey` | banner |
   | `Workspace.favicon*`（默认/亮/暗三种变体） | favicon |
   | `FileAsset.storageKey` | file_asset |
   | `ClassroomFile.storageKey` | classroom_file |

`storageKey` 全局唯一且与 bucket 无关，这是"换存储后端后引用仍然成立"的关键。注意 `storageKey` 形如 `workspace/file.pdf`，**含 `/`**，打包时必须做平铺与清洗（见 §4）。

## 3. 现有可复用资产

不从头发明，尽量复用已证明的代码：

| 资产 | 位置 | 复用方式 |
| ---- | ---- | -------- |
| 对象枚举（按 DB 引用收集 storageKey + backend） | `apps/api/scripts/migrate-storage-to-r2.ts` 的 `collectRefs` | 导出/导入两侧直接复用；去掉"翻转源库 backend"副作用 |
| 对象逐项复制 + 校验 + 切换 | 同上 `migrateOne`、`Summary` | 导入侧改目标为"当前激活 backend"，目标后端参数化（原实现硬编码 `r2`）；期望大小改为仅以 manifest 为准 |
| 数据库备份/恢复配方 | `docs/migrate-data-to-vercel-r2.md`（pg_dump 排除表、pg_restore、离线升级、单 baseline） | 沿用其 dump/restore 参数与校验思路；目标腾空与 resolve 步骤按本文 §7 加强 |
| 迁移后校验 | `apps/api/scripts/verify-vercel-data-migration.ts` | 改编为通用校验函数（行数对比、孤立引用、缺失对象=0） |
| 最高管理员判定 | `StorageService.requireSuperAdmin`（`apps/api/src/modules/storage/storage.service.ts`）、`isSuperAdmin`（`packages/shared/src/permissions.ts`） | 新模块复用 |
| 存储后端抽象 | `apps/api/src/modules/storage/storage-backend.ts`、`StorageService.backendFor`/`activeBackend` | 导入写对象、导出读对象统一走这套接口 |

**设计规则（本次核心决策）**：

> **导出端不修改源数据库**；只有导入端在"对象写入目标存储并逐对象校验成功后"，才把该记录的 `storageBackend` 翻转为目标后端。
> 现有 `migrate-storage-to-r2` 脚本是"复制 + 顺手改源库标记"一起做的，新功能只借复制逻辑，不借改库副作用。

这样源部署行为零变化，彻底规避兼容性问题。

## 4. 迁移包格式

导出产物为一个 tar 包（或目录），统一命名 `liveboard-migration-<jobId>.tar`。
`jobId` 为迁移任务 ID（cuid），同一任务重跑时包目录稳定不变，才能命中
"已存在且大小一致则跳过"的断点续传逻辑：

```text
liveboard-migration-<jobId>.tar
├── manifest.json       # 元信息、迁移历史与对象清单
├── database.dump       # pg_dump -Fc 完整快照（见 §6.1）
└── objects/            # 可选：按方向决定是否包含
    └── <扁平清洗文件名> # 平铺存放，不用原始 storageKey 做路径（见下）
```

### 对象存放规则（防路径穿越）

`storageKey` 含 `/`，且包可能经管理员电脑中转，不能拿它直接当解压路径：

- 导出时每个对象存为 `objects/<序号>-<清洗名>`，清洗规则：非 `[A-Za-z0-9._-]` 字符替换为 `_`，取 key 末段；序号保证唯一。
- manifest 的每个对象条目记录 `path`（包内路径）与 `storageKey`（目标写入 key）的映射；导入只信 manifest，解压时校验条目路径不得逃出 `objects/` 前缀。

### manifest.json 字段

```jsonc
{
  "formatVersion": 1,              // 迁移包格式版本
  "appVersion": "0.3.1",           // 源应用版本；导入端要求与目标完全一致（§7.1）
  "exportedAt": "2026-08-04T…",
  "source": "server" | "vercel",   // 源部署形态
  "dumpSha256": "…",               // database.dump 的 sha256，导入前必验
  "migrations": [                  // 源库 _prisma_migrations 已应用历史（名称+checksum，按应用顺序）
    { "name": "00000000000000_baseline_v1", "checksum": "…" }
    // …后续 migration（如 MigrationJob 对应条目）
  ],
  "tables": { "User": 123, "File": 456, … },   // 各业务表行数（除排除清单外全部表，导入后对账）
  "objects": [                     // 全部非空存储引用
    {
      "kind": "file_asset",
      "storageKey": "…",
      "path": "objects/0001-file.pdf",   // 包内路径（直推/直拉模式下该字段缺省）
      "sizeBytes": 1048576,        // 必填：导出时 stat 写入（avatar/banner/favicon 在 DB 无大小字段，只能靠它）
      "sha256": "…",
      "mimeType": "…"
    }
  ],
  "options": {
    "includeAiSecrets": false      // 固定 false；注意 dump 物理上仍含加密密文，导入后第一步抹除（§7.5）
  }
}
```

对象清单即"按 DB 引用枚举"的结果；导出/导入均以清单为准，**不列 bucket 目录**（三个后端接口都没有 listObjects，现有脚本也是按 DB 引用收集）。

## 5. 总体架构：导出器 / 导入器

一套引擎，两种前端（后台按钮 + 命令行），覆盖四方向。Vercel 侧不写迁移代码——所有"打包账本/搬文件"都发生在服务器或管理员电脑上。

```text
┌─ 导出器（源侧）─────────────────────────────┐
│  输入：源 DB 连接 + 源存储凭据                  │
│  产出：迁移包（manifest + database.dump        │
│         [+ objects/]），或直接推送到目标存储     │
└───────────────────────────────────────────────┘
        │ 传输：包走管理员电脑 / 对象走直推或直拉
┌─ 导入器（目标侧）─────────────────────────────┐
│  输入：迁移包 + 目标 DB 连接 + 目标存储凭据      │
│  动作：校验包 → 腾空目标库 → 还原 DB            │
│        → resolve 迁移历史 → 抹除密钥            │
│        → 对象写入激活后端 → 逐对象校验后翻转     │
│        → 校验对账                              │
└───────────────────────────────────────────────┘
```

### 5.1 引擎形态

- 核心逻辑写成**可命令行调用的 Node 脚本**（沿用 `apps/api/scripts/*.ts` + `tsx` 的既有模式），如：
  - `apps/api/scripts/migrate-export.ts`（导出器）
  - `apps/api/scripts/migrate-import.ts`（导入器）
  - `apps/api/scripts/migrate-verify.ts`（校验，可由导入器内部调用）
- 服务器后台的**一键按钮只是调用同一引擎**，并包一层异步任务 + 进度 + 向导。
- 新增 `MigrationJob` 模型（Prisma，新 migration）记录导出/导入任务状态与进度，其特殊规则见 §5.3。

### 5.2 后台按钮可用范围

| 方向 | 导出按钮 | 导入按钮 | 说明 |
| ---- | -------- | -------- | ---- |
| server → server | ✅ 源服务器 | ✅ 目标服务器 | 全程按钮；包经管理员电脑搬运后**以路径式导入**（§6.5） |
| server → vercel | ✅ 源服务器 | ❌ Vercel 无按钮 | DB 还原由管理员电脑执行；对象由源服务器直推 R2 |
| vercel → server | ❌ Vercel 无按钮 | ✅ 目标服务器 | DB 由管理员电脑 dump；对象由目标服务器直拉 R2 |
| vercel → vercel | ❌ | ❌ | 管理员电脑执行引擎 + 向导 |

### 5.3 MigrationJob 规则（消除与验证链路的冲突）

`MigrationJob` 表在 baseline 之后的 migration 中引入，会与"dump 还原 + resolve + 无 drift"链路产生三处冲突，规则如下：

1. **dump 排除数据**：`--exclude-table-data` 增加 `MigrationJob`。表结构随 dump 还原（源/目标同版本，结构一致），源端任务记录不带入目标。
2. **导入期间不依赖目标库存状态**：导入第一步就是腾空目标库，期间目标 DB 完全不可用，`MigrationJob` 也不存在。导入任务状态写**本地状态文件**（`/opt/liveboard/migration/jobs/<id>.json`）+ 进程内内存；还原完成、表恢复后才把导入任务记录 upsert 回 `MigrationJob`。
3. **resolve 覆盖全部历史**：还原后按 manifest `migrations` 列表**逐条** `prisma migrate resolve --applied`（包括 baseline 和 MigrationJob 对应的 migration），而不是只 resolve baseline；执行前先核对每条 migration 在目标应用 `prisma/migrations` 目录中存在且 checksum 一致，不一致 fail-closed。
4. 导入期间目标侧 Web/API 对普通用户不可用（DB 被重建）；进度由 CLI 输出与状态文件提供，UI 通过不依赖 DB 的只读端点读取状态文件。

## 6. 导出器详细设计

### 6.1 数据库快照

使用 PostgreSQL 官方 `pg_dump -Fc`（快照一致，`pg_restore` 恢复成熟，项目已信任此路径）。必须排除数据的表（保留结构、排除数据）：

```bash
pg_dump -Fc \
  --exclude-table-data='"_prisma_migrations"' \
  --exclude-table-data='"PendingUpload"' \
  --exclude-table-data='"ServerMetricSample"' \
  --exclude-table-data='"MigrationJob"' \
  -f database.dump "<源DB URL>"
```

导出完成后计算 `database.dump` 的 sha256 写入 manifest（`dumpSha256`）。

运行时依赖与版本约束：

- **源/目标服务器需要 `pg_dump`/`pg_restore` 二进制**。当前 API runner 镜像是 `node:22-alpine`（`apps/api/Dockerfile`），未安装。方案：runner 镜像加入 **`postgresql16-client`**（锁定 major，与自托管 `postgres:16-alpine` 匹配），代价是重打自托管离线发布包（`.run`）。
- pg 客户端 major 版本必须 ≥ 服务端 major。Vercel 侧（Neon）dump/restore 在管理员电脑执行时，电脑上的 pg client 同样必须 ≥ Neon 的 PG major；且必须使用**直连（非 pooler）连接串**，遵循 `docs/deploy-vercel-r2.md` 的 `DIRECT_DATABASE_URL` 约定。
- 备选：导出/导入通过 `docker exec` 调用 postgres 容器内的 `pg_dump`/`psql`，避免改镜像但耦合 Docker 容器名。

### 6.2 对象导出

- 复用 `collectRefs` 收集全部非空存储引用（avatar/banner/favicon/file_asset/classroom_file）。`pending/` 前缀的临时对象只被 `PendingUpload` 引用，天然不在收集范围内，不会进包。
- 逐对象先 `statObject` 取真实大小（**`sizeBytes` 必填**：avatar/banner/favicon 在 DB 无大小字段，manifest 是唯一依据），再 `getObject` **流式**写入包内平铺路径，计算 `sha256` 写入 manifest。
- **不修改源库任何 `storageBackend`**。
- 可重跑：导出中断后重新执行即可；已写入且大小、sha256 一致的对象自动跳过，dump 重新生成（MVCC 快照保证一致）。

### 6.3 对象传输策略（按方向，即"离目标近谁搬"）

| 方向 | 策略 | 说明 |
| ---- | ---- | ---- |
| server → server | 打进包（默认），或源存储是公网 OSS 时由目标服务器直拉 | MinIO 一般只监听内网，目标拉不到 → 走包 |
| server → vercel | 源服务器**直接推 R2**（`migrateOne` 复制逻辑，目标改为 R2）| 避免大文件先下后传；DB dump 仍需随包走管理员电脑 |
| vercel → server | **目标服务器从 R2 直拉** | Vercel 无法推送，目标服务器（有 R2 凭据）主动拉 |
| vercel → vercel | 管理员电脑或任一台服务器执行 R2→R2 复制 | 两侧都够不到内网存储，必须第三方中转 |

直推/直拉的**凭据与执行主体**（v2 补齐）：

- **server → vercel（直推）**：向导引导管理员把**目标 R2 凭据**一次性输入源服务器（仅存于该导出任务进程/加密临时文件，任务结束即删除，不落 `StorageSettings`、不进日志）。源服务器只负责推对象；`storageBackend` 翻转**必须等 DB 还原完成后**执行——由管理员电脑（持目标直连 URL）运行 `migrate-import --finalize-objects` 完成"逐对象 stat + 翻转"。顺序：推对象 → 还原 dump → resolve → 抹密钥 → finalize-objects → 校验。
- **vercel → server（直拉）**：管理员把**源 R2 凭据**交给目标服务器（同样一次性、任务结束即删），目标服务器拉对象入库后走正常的逐对象校验 + 翻转。
- **vercel → vercel（R2→R2）**：同一进程需同时持有源/目标两套 R2 凭据。现有 `resolveR2ClientConfig(process.env)` 只读一套环境变量，引擎需支持 `SOURCE_R2_*` / `TARGET_R2_*` 双前缀构造两个 `R2StorageBackend` 实例。

当对象走直推/直拉时，`objects/` 目录可以不进包，manifest 中的对象清单仍保留用于校验。

### 6.4 一致性

- `pg_dump` 基于 MVCC 快照，DB 侧天然一致。
- 对象侧：某条已提交记录引用的 `storageKey`，其对象必然已落盘（上传流程先落对象后落记录）。但 dump 快照生成后、对象导出完成前，若业务删除了某记录及其对象，该对象会缺失。
- 因此**导出期间默认开启维护/只读模式**（P0 开关，见 §9）：拒绝全部普通写操作，super_admin 仍可登录、开关维护模式、执行导出。文档同时建议低峰执行。
- server → vercel 允许"先预复制增量、维护窗口收尾"的两段式（沿用既有手册 §5 做法）：预复制阶段不开维护模式（只复制、不翻转），最终快照 + 收尾复制必须在维护模式内完成。

### 6.5 包的存储与交付（v2 新增）

- 自托管侧新增迁移目录：宿主机 `/opt/liveboard/migration` 挂载进 api 容器 `/data/migration`（docker-compose 与 `.run` 安装器同步，P0）。导出包写入该目录，权限 `700`，属主为容器运行用户。
- **导出下载**：后台按钮生成的包优先提示管理员"从服务器目录取包"（scp/sftp）；同时提供 HTTP 流式下载（支持 `Range` 断点续传），Nginx 对该路由关闭代理缓冲、读取超时对齐大文件传输。
- **导入输入以路径式为主**：管理员把包放到目标服务器 `/opt/liveboard/migration/incoming/` 后，在后台选择该包导入。浏览器上传仅作小包可选通道——现有 `client_max_body_size 100m`（`infra/nginx/liveboard.conf`）不放宽，含视频的大包必然超限，不走浏览器。
- 导入成功或明确放弃后清理 `incoming/` 中的包；清理前二次确认。

## 7. 导入器详细设计

### 7.1 前置校验（全部 fail-closed）

1. `formatVersion` 支持；
2. **`appVersion` 与目标应用版本完全一致**。不一致直接拒绝并提示两条出路：把其中一侧升级到同版本，或对 dump 执行 `docs/migrate-data-to-vercel-r2.md` §4 的离线升级流程后重新打包/导入（一期不提供自动化）；
3. `dumpSha256` 与实际文件一致；
4. manifest `migrations` 列表与目标应用 `prisma/migrations` 目录逐条比对（名称存在、checksum 一致、顺序兼容），不一致拒绝；
5. 目标允许已有数据（已确认决策）：导入器会**先彻底腾空目标数据库**再还原，**不做自动备份**。这是不可逆操作，导入前必须有管理员二次确认（输入确认语），并建议目标为低价值/测试数据。
6. 还原后**不得运行** `bootstrap-production.ts` / `seed.cjs` / `db reset`——源数据自带最高管理员与 workspace，`bootstrapProduction` 检测到已有 super_admin 会自动跳过，天然安全。

### 7.2 数据库还原（v2 重排的核心顺序）

既有手册的 restore 前提是"全新、空的目标库"；本设计允许目标已有数据，因此**腾空必须彻底到 schema 级**（只 TRUNCATE 数据不行——dump 含全部 CREATE TABLE/序列/索引/约束，表已存在时 `pg_restore --exit-on-error` 会立刻失败）：

```sql
-- 1) 停写：目标进入维护模式并停止 api/web 的普通服务（导入期间目标不可用）
-- 2) 腾空目标库（连接目标库执行）
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO PUBLIC;   -- 按目标库用户补回必要权限
```

```bash
# 3) 还原（任何错误立即终止，不允许忽略后继续）
pg_restore --no-owner --no-privileges --exit-on-error \
  -d "<目标DB URL>" database.dump
```

还原前先按既有手册 §3 用 `pg_restore --list` 确认 dump 中 `_prisma_migrations`/`PendingUpload`/`ServerMetricSample`/`MigrationJob` 四张表没有 `TABLE DATA`，有则拒绝导入。

### 7.3 迁移历史标记（resolve 全部，不只 baseline）

按 manifest `migrations` 逐条执行（§5.3 规则 3）：

```bash
prisma migrate resolve --applied <migration_name>   # 对每条已应用 migration 各执行一次
```

验证：

- `_prisma_migrations` 记录与 manifest `migrations` 一一对应且全部成功；
- `prisma migrate status` 无 pending；
- `prisma migrate diff --exit-code` 确认实际 schema 与 `schema.prisma` 无 drift（同版本前提下还原后即应一致）。

### 7.4 还原后恢复服务前置条件

完成 §7.3 与 §7.5 之前，目标 API 不得对普通用户开放；`MigrationJob` 表恢复后写入本次导入任务记录（§5.3 规则 2）。

### 7.5 密钥与配置清理（还原后第一步，硬性步骤）

dump 物理上包含源端的加密密钥密文，必须在任何业务服务接入目标库**之前**抹除：

- `AiProviderConfig.apiKey`：**全部置空**。AI 配置其余部分（模型名、端点等）保留，密钥由目标在 AI 设置里重新填写。目标与源因此无需共享 `AI_ENCRYPTION_KEY`。
- `StorageSettings`：非 OSS 目标清空 OSS AccessKey、加密 Secret、Endpoint 及标志（MinIO/R2 凭据来自环境变量）；**OSS 目标写回导入前捕获的目标自身 OSS 配置**（加密 Secret 原样保留，目标无需重新配置，也不会把源端凭据带进来）。
- 密码哈希（argon2）直接透传，无需重置。

### 7.6 对象导入与 backend 翻转

这是**"换存储不破坏引用"的关键步骤**：

1. 确定目标当前激活后端：`StorageService.activeBackend()`（Vercel 固定 R2，自托管取 `StorageSettings.backend`）。
2. 按 manifest 对象清单，把 `path` 指向的包内对象（或直拉/直推来源的对象）`putObject` 到目标存储（写入原始 `storageKey`）。已存在且大小一致的对象自动跳过（复用 `migrateOne` 的幂等逻辑），因此该步骤可中断重跑。
3. **逐对象** `statObject` 校验存在与大小；期望值**只以 manifest `sizeBytes` 为准**（导入时源往往不可达，且 avatar/banner/favicon 无 DB 大小字段）。单个对象验证成功后才把该记录 `storageBackend` 翻转为目标后端（目标后端参数化，不硬编码）。禁止提前批量 UPDATE。
4. 缺失对象 / 大小不符 → 记录并失败，`缺失对象=0` 才允许上线，否则阻断。

### 7.7 导入后校验

改编 `verify-vercel-data-migration.ts` 为通用校验：

- 除排除清单外全部业务表行数与 manifest `tables` 一致；
- 关键外键无孤立引用；
- 至少存在一名正常最高管理员；
- 所有非空存储引用在目标存储存在且大小正确，`storageBackend` 均为目标后端；
- `_prisma_migrations` 与 manifest `migrations` 一致、无 pending、无 drift；
- `AiProviderConfig.apiKey` 与 `StorageSettings` 凭据字段确认为空；
- 缺失对象数为 0，否则阻断上线。

### 7.8 Redis 与会话（v2 新增说明）

Redis 中的运行时状态（会话、登录失败计数、分片上传会话、AI 限流窗口）**不在迁移包内、也不迁移**。后果属预期行为：导入完成后目标端所有用户需重新登录；限流计数从零开始。文档与导入结果页需明示，避免被当成故障。

## 8. 权限与安全

- 导出/导入端点仅 `super_admin` 可调用（复用 `requireSuperAdmin`）。
- 迁移包含全部用户内容、密码哈希与**加密密钥密文**（AI apiKey、OSS Secret），视为高敏数据：仅 HTTPS 下载/上传；迁移目录与包文件权限 `700`；记录审计日志（谁、何时、导出/导入、包名）；日志不打印 Secret/签名 URL/对象内容。
- 直推/直拉场景下目标/源 R2 凭据的交接：只存于任务进程的加密临时文件，任务结束（成功或失败）立即删除，不写 `StorageSettings`、不进日志（见 §6.3）。
- 包解压/读取必须校验对象条目路径不逃出 `objects/` 前缀（防路径穿越，即使包是用户自己电脑生成的）。
- 后端按钮生成的任务需要二次确认弹窗（提示影响面）；导入额外要求输入确认语（§7.1）。

## 9. 分阶段实施

> 每一阶段独立可交付、可验证；引擎一次建成，四个方向逐个接线。

### P0 基础设施
- `apps/api/Dockerfile`：runner 镜像加入 `postgresql16-client`（已确认决策，重打自托管离线发布包）。
- Prisma：新增 `MigrationJob` 模型 + migration（记录任务状态/进度/方向/结果；dump 排除规则见 §5.3）。
- docker-compose 与 `.run` 安装器：新增 `/opt/liveboard/migration` ↔ 容器 `/data/migration` 挂载（§6.5）。
- "维护/只读模式"开关（已确认决策）：拒绝普通写操作 + 前端横幅；super_admin 保留登录、开关与导出能力；导出期间默认开启。

### P1 引擎 + server → server
- 新增 `apps/api/scripts/migrate-export.ts`、`migrate-import.ts`、`migrate-verify.ts`（抽取 `collectRefs`/`migrateOne` 的通用化版本：去掉源库翻转副作用、目标后端参数化、期望大小仅以 manifest 为准）。
- 新 `MigrationModule`（`apps/api/src/modules/migration/`）：`POST admin/migration/export`、`POST admin/migration/import`、`GET admin/migration/jobs/:id`（含读本地状态文件的降级路径，§5.3）。
- Web 后台 `/app/admin/migration` 页：导出按钮 + 进度 + 取包指引；导入支持"选择 incoming 目录中的包"（主）与浏览器上传小包（辅）+ 二次确认输入框 + 结果展示。
- 导入按 §7.2 顺序执行：腾空 → 还原 → resolve → 抹密钥 → 对象 → 校验。
- 产出与校验：server→server 全程按钮跑通，`migrate-verify` 全绿。

### P2 server → vercel
- 导出器支持"对象直推 R2"模式（复用 `migrateOne` 复制逻辑，目标 = R2；目标 R2 凭据走一次性交接，§6.3）。
- `migrate-import --finalize-objects`：DB 还原后在管理员电脑执行的"逐对象 stat + backend 翻转"收尾命令。
- 向导页指导管理员在电脑执行 DB 还原（直连 URL）+ resolve + Vercel 环境配置。
- 产出：源服务器点导出 → 对象直推 R2 + 下载 `database.dump` → 管理员电脑一条命令还原 → finalize → Vercel 后台填 AI 密钥。

### P3 vercel → server / vercel → vercel
- 提供"管理员电脑可跑的导出工具"（用公网直连连接串 `pg_dump` + 从源 R2 拉对象），复用同一引擎。
- vercel→server 的对象由目标服务器从源 R2 直拉（凭据一次性交接）；vercel→vercel 由管理员电脑/中转服务器执行 R2→R2 复制（`SOURCE_R2_*`/`TARGET_R2_*` 双配置，§6.3）。
- 文档补齐向导。

### P4 文档
- `docs/migrate-server-to-server.md`（操作手册，含演练清单与回滚规则）；
- `docs/migrate-to-vercel-r2.md`（server→vercel 一键向导版，可替代/引用现有手册）；
- `docs/migrate-from-vercel.md`（vercel→server / vercel→vercel）。

## 10. 校验与回滚

- 回滚规则：源部署全程只读不删；目标验证失败即停止，恢复源入口；不把目标新写入反向合并回源。
- 导入前彻底腾空目标库（已确认决策：不做自动备份）。该操作不可逆，依赖 §7.1 的二次确认护栏；目标如有不可再生的数据，应由管理员自行决定是否提前手动备份。
- 演练要求：正式迁移前在测试环境完整跑一遍四方向，记录耗时（含腾空、还原、对象复制、校验各阶段）。

## 11. 风险与边界

| 风险 | 说明 | 缓解 |
| ---- | ---- | ---- |
| 服务器缺 `pg_dump` 二进制 | 当前 runner 镜像未带 | P0 加 `postgresql16-client`（锁定 major），重打离线发布包 |
| pg client 与服务端版本不匹配 | client major < server major 会失败 | 文档明示版本约束；Neon 侧用管理员电脑时同样检查 |
| Vercel 无服务器限制 | 无 psql、函数时长/内存受限、无持久磁盘 | 凡有 Vercel 的方向，DB 步骤落到管理员电脑（直连 URL）；Vercel 侧零迁移代码 |
| 大包存储与传输 | 课堂文件可能很大（视频），浏览器上传有 100m 上限，容器无大容量临时盘 | 迁移目录挂载（§6.5）+ 路径式导入为主 + 流式下载/Range；浏览器上传仅小包 |
| 密钥跨环境 | AI apiKey / OSS Secret 密文物理上在 dump 中 | 导入后第一步强制抹除（§7.5）；包按高敏数据管理（§8）；目标重新填写密钥 |
| 版本漂移 | 源/目标 schema 不一致 | 强制同版本 fail-closed；跨版本走既有手册离线升级路径 |
| MigrationJob 与验证链路冲突 | 新表破坏 resolve/drift 校验 | §5.3 规则：排除数据、本地状态文件、resolve 全部历史 |
| 导入期间目标不可用 | 目标 DB 被腾空重建 | 状态文件 + 不依赖 DB 的只读状态端点；向导明示停机窗口 |
| 导出窗口写活动 | 快照后删除会造成对象缺失 | 导出期间默认开启维护模式（§6.4）+ 校验阻断 |

## 12. 已确认决策（2026-08-04）

| # | 决策 | 结论 |
| - | ---- | ---- |
| 1 | 服务器 `pg_dump` 方案 | 改 runner 镜像加 `postgresql-client`，重打自托管离线发布包 |
| 2 | "维护/只读模式"开关 | 做，纳入 P0 |
| 3 | AI 密钥迁移 | 不迁移，导入后目标重新填写；目标无需共享 `AI_ENCRYPTION_KEY` |
| 4 | 导入目标已有数据 | 允许；直接清空目标数据后导入，**不做自动备份**（导入前二次确认护栏） |
| 5 | 版本兼容策略 | 一期强制源/目标同版本 fail-closed；跨版本引用既有手册 §4 离线升级 |
| 6 | 目标腾空方式 | `DROP SCHEMA public CASCADE` 后重建，不做表级 TRUNCATE |
| 7 | MigrationJob 处理 | dump 排除数据；导入期间用本地状态文件；resolve 覆盖全部 migration |
| 8 | 导入输入方式 | 路径式导入（`/opt/liveboard/migration/incoming/`）为主，浏览器上传仅 ≤100m 小包 |
| 9 | 直推/直拉凭据交接 | 一次性加密临时文件，任务结束即删，不落库不进日志 |
