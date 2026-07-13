# LiveBoard

[![CI](https://github.com/HFLive/liveboard/actions/workflows/ci.yml/badge.svg)](https://github.com/HFLive/liveboard/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?logo=nextdotjs&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?logo=nestjs&logoColor=white)

LiveBoard 是一个面向课程团队的自托管教学工作台，将课程资料、课堂演示、在线练习、权限管理、论坛与 AI 助手放在同一套系统中。

> 项目目前处于持续开发阶段，适合本地试用和二次开发。生产部署前请完成安全配置检查，并替换全部默认凭据。

## 功能

- **内容**：以文件夹和内容块组织文档、教案、课程及练习资料。
- **授课模式**：根据标题自动拆分页，支持目录、页面总览、键盘翻页和全屏演示。
- **在线练习**：创建题目、提交答案、自动评分和人工批阅。
- **素材库**：上传、预览、引用并追踪课程附件。
- **论坛**：使用版块、主题和回复组织课程交流。
- **AI 助手**：基于用户有权访问的内容提供回答。
- **权限体系**：通过权限组向文件夹或文件授予所有者、编辑、授课、查看或禁止访问权限。
- **管理中心**：管理用户、权限组、论坛、AI、存储和系统设置。

## 技术栈

| 层级 | 技术                                           |
| ---- | ---------------------------------------------- |
| Web  | Next.js 15、React 19、TypeScript               |
| API  | NestJS 11、Prisma                              |
| 数据 | PostgreSQL 16、Redis 7                         |
| 文件 | MinIO                                          |
| 工程 | pnpm workspace、Docker Compose、GitHub Actions |

## 快速开始

### 环境要求

- Node.js 22
- pnpm 11
- Docker Desktop 或兼容的 Docker 环境

### 本地开发

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev
```

服务地址：

| 服务         | 地址                         |
| ------------ | ---------------------------- |
| Web          | http://localhost:3000        |
| API 健康检查 | http://localhost:4000/health |
| MinIO 控制台 | http://localhost:9001        |

`pnpm dev` 会启动支持热更新的 Next.js 和 NestJS 开发服务器。PostgreSQL、Redis 与 MinIO 继续由 Docker 提供。

### 演示账号

执行种子数据后会创建以下本地账号：

| 账号       | 密码                 | 用途       |
| ---------- | -------------------- | ---------- |
| `admin`    | `liveboard-admin`    | 最高管理员 |
| `author`   | `liveboard-author`   | 内容维护   |
| `lecturer` | `liveboard-lecturer` | 授课与批阅 |
| `learner`  | `liveboard-learner`  | 学习与提交 |

这些账号仅用于本地演示。生产环境必须修改或删除默认账号，并将 `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` 设置为 `false`。

## Docker 运行

启动完整的生产构建：

```bash
docker compose up --build -d
docker compose ps
```

`migrate` 容器会在 API 启动前执行 `prisma migrate deploy`。首次部署会执行完整的初始 migration，此后只执行尚未应用的增量 migration。迁移失败时 API 和 Web 不会启动。

生产服务器更新推荐使用：

```bash
pnpm deploy:prod
```

部署脚本会先检查 `.env` 中的 PostgreSQL、MinIO 和会话密钥，拒绝默认值、空值和过短密钥；同时拒绝带有未提交改动的工作区。检查通过后依次完成 PostgreSQL 备份、`git pull --ff-only`、镜像构建、数据库迁移、服务启动和 API 健康检查。备份默认写入不会被 Git 跟踪的 `backups/`，可通过 `BACKUP_DIR` 修改位置。

> 数据库备份不包含 MinIO 上传文件。生产环境还应对 `minio-data` 配置独立的对象存储备份或快照。

停止全部容器：

```bash
docker compose down
```

> Docker Compose 中的 Web 使用生产构建，不支持代码热更新。开发时请仅保留基础设施容器，并使用 `pnpm dev` 启动 Web 与 API。

## 常用命令

```bash
pnpm dev          # 启动 Web 与 API 开发服务器
pnpm dev:web      # 只启动 Web
pnpm dev:api      # 只启动 API
pnpm infra:up     # 启动 PostgreSQL、Redis、MinIO
pnpm infra:down   # 停止 Compose 服务
pnpm deploy:prod  # 备份、更新并发布生产版本

pnpm db:generate  # 生成 Prisma Client
pnpm db:migrate   # 创建并执行 Prisma migration
pnpm db:reset     # 重建本地测试数据库并重放 migrations
pnpm db:seed      # 写入本地演示数据

pnpm format       # 格式化代码
pnpm typecheck    # TypeScript 检查
pnpm test         # 运行测试
pnpm build        # 构建全部包
pnpm validate     # 执行完整提交前检查
```

## 项目结构

```text
liveboard/
├── apps/
│   ├── api/                 # NestJS API、Prisma 和种子数据
│   └── web/                 # Next.js App Router 前端
├── packages/
│   └── shared/              # 前后端共享类型、权限和评分逻辑
├── infra/nginx/             # Nginx 示例配置
├── docker-compose.yml
├── AGENTS.md                # Codex/开发代理工作约定与开发纪要
└── README.md
```

主要页面：

| 功能     | 路由                       |
| -------- | -------------------------- |
| AI 助手  | `/app/ai`                  |
| 内容     | `/app/content`             |
| 内容编辑 | `/app/content/:id`         |
| 授课模式 | `/app/content/:id/present` |
| 素材库   | `/app/library`             |
| 在线练习 | `/app/exercises`           |
| 论坛     | `/app/forum`               |
| 管理中心 | `/app/admin`               |

## 权限模型

系统角色分为 `super_admin`、`admin` 和 `member`。最高管理员拥有全站权限，管理员负责内容与成员管理，普通用户的具体资源权限通过权限组授予：

| 权限        | 能力               |
| ----------- | ------------------ |
| `owner`     | 管理内容与授权     |
| `editor`    | 编辑内容           |
| `lecturer`  | 查看并使用授课功能 |
| `viewer`    | 查看已发布内容     |
| `no_access` | 显式禁止访问       |

所有资源访问都必须经过后端权限检查；前端隐藏按钮仅用于改善体验，不作为安全边界。

## 环境变量

复制 `.env.example` 后按环境修改。常用变量：

| 变量                             | 说明                            |
| -------------------------------- | ------------------------------- |
| `WEB_ORIGIN`                     | 允许携带凭据访问 API 的前端来源 |
| `NEXT_PUBLIC_API_URL`            | 浏览器访问 API 的公开地址       |
| `DATABASE_URL`                   | PostgreSQL 连接地址             |
| `POSTGRES_DB`                    | PostgreSQL 数据库名             |
| `POSTGRES_USER`                  | PostgreSQL 用户名               |
| `POSTGRES_PASSWORD`              | PostgreSQL 密码                 |
| `REDIS_URL`                      | Redis 连接地址                  |
| `SESSION_SECRET`                 | 会话签名密钥                    |
| `MINIO_*`                        | MinIO 地址、凭据和 bucket       |
| `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` | 是否在登录页显示演示账号        |

不要提交 `.env`、真实密码、API Key、数据库备份或用户上传内容。

## 生产部署检查

- 使用随机且足够长的 `SESSION_SECRET`。
- 替换 PostgreSQL、MinIO 和演示账号默认密码。
- 关闭登录页演示账号提示并重新构建 Web。
- 使用 HTTPS，避免直接向公网开放数据库、Redis、MinIO 和 API 管理端口。
- 使用 `pnpm deploy:prod` 在更新前生成数据库备份，并为 MinIO 配置独立备份。
- 为登录、上传和 AI 接口配置网关限流。
- 所有 schema 变更都提交 Prisma migration；生产环境由 `migrate` 服务自动执行 `prisma migrate deploy`，不使用 `db push`。

## 参与开发

1. 从 `main` 创建短生命周期分支。
2. 完成修改后运行 `pnpm validate`。
3. PR 中说明问题、方案、数据迁移、验证结果；涉及 UI 时附桌面端和移动端截图。
4. 不提交生成目录、本地数据或秘密配置。

面向开发代理的具体约定、历史决策和易错点维护在 [AGENTS.md](./AGENTS.md)。
