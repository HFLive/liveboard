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

Compose 发布到宿主机的端口仅绑定 `127.0.0.1`。生产环境应由宿主机 Nginx、Caddy 或其他网关将公网 HTTPS 请求转发到 Web `127.0.0.1:3000` 和 API `127.0.0.1:4000`，不得直接向公网开放 PostgreSQL、Redis、MinIO、API 或 Web 容器端口。使用同一域名的 `/api/` 反向代理时，将 `NEXT_PUBLIC_API_URL` 设置为 `https://example.com/api`；该变量会在 Web 镜像构建时写入浏览器端代码，修改后必须重新构建 Web 镜像。

生产服务器更新推荐使用：

```bash
pnpm deploy:prod
```

部署脚本会先检查 `.env` 中的 PostgreSQL、MinIO 和会话密钥，拒绝默认值、空值和过短密钥；同时拒绝带有未提交改动的工作区。检查通过后依次完成 PostgreSQL 备份、`git pull --ff-only`、镜像构建、数据库迁移、服务启动和 API 健康检查。备份默认写入不会被 Git 跟踪的 `backups/`，可通过 `BACKUP_DIR` 修改位置。

> 数据库备份不包含 MinIO 上传文件。生产环境还应对 `minio-data` 配置独立的对象存储备份或快照。

### GitHub Release 离线镜像部署

中国内地服务器推荐使用 GitHub Release 部署，避免服务器直接访问 Docker Hub、容器镜像仓库和 npm registry。推送 `v` 开头的语义化版本标签后，`.github/workflows/release.yml` 会在 GitHub Actions 中：

1. 拉取固定版本的 PostgreSQL、Redis 和 MinIO 运行镜像；
2. 以 `NEXT_PUBLIC_API_URL=/api` 构建 Linux AMD64 的 API 与 Web 镜像；
3. 将全部运行镜像、Compose、环境变量模板、部署脚本、镜像清单和 SHA256 校验打入一个压缩包；
4. 创建同名 GitHub Release，并只上传 `liveboard-<version>-linux-amd64.tar.gz`。

首次发布前，在 GitHub 仓库的 `Settings > Actions > General > Workflow permissions` 中确认工作流拥有 `Read and write permissions`。合并待发布代码后创建标签：

```bash
git switch main
git pull --ff-only
git tag v0.1.1
git push origin v0.1.1
```

等待 GitHub Actions 中的 `Release` 工作流成功，并确认对应 Release 只有一个 Linux AMD64 压缩包。

#### 电脑下载后上传到服务器

可以直接在浏览器打开 GitHub Release 页面下载 `liveboard-v0.1.1-linux-amd64.tar.gz`，也可以在电脑的仓库目录执行：

```bash
gh release download v0.1.1 \
  --pattern 'liveboard-v0.1.1-linux-amd64.tar.gz' \
  --dir ~/Downloads/liveboard-v0.1.1
```

电脑只需向服务器上传这一个文件：

```bash
scp ~/Downloads/liveboard-v0.1.1/liveboard-v0.1.1-linux-amd64.tar.gz \
  root@服务器IP:/opt/
```

服务器只需安装 Docker Engine、Docker Compose 插件、curl、tar、gzip 和 sha256sum，不需要 Git、Node.js 或 pnpm，也不需要访问 Docker Hub。解压并运行：

```bash
cd /opt
tar -xzf liveboard-v0.1.1-linux-amd64.tar.gz
cd liveboard-v0.1.1-linux-amd64
sh deploy.sh
```

第一次运行会根据包内的生产配置模板创建 `/opt/liveboard/.env` 并停止部署。编辑其中的域名、数据库密码、MinIO 密码和 `SESSION_SECRET`，确认所有 `example.com` 和 `replace-with-*` 默认值均已替换，然后再次运行：

```bash
nano /opt/liveboard/.env
sh deploy.sh
```

以后升级只需下载并上传新版本的单个压缩包，解压后运行其中的 `deploy.sh`。生产配置、数据库卷和备份继续保存在稳定位置，不会因解压到新的版本目录而丢失。

#### 服务器直接下载

网络允许时，仍可在服务器上的仓库目录用辅助脚本下载并部署。新版本只下载一个压缩包；脚本也兼容 `v0.1.0` 的四文件格式：

```bash
cd /opt/liveboard
git pull --ff-only
sh scripts/deploy-release.sh v0.1.1
```

两种方式都会校验包内文件，导入镜像，启动基础设施，备份 PostgreSQL，执行 Prisma migration，更新 API 与 Web，并等待健康检查。数据库备份默认保存在 `/opt/liveboard/backups/`，当前成功版本记录在 `/opt/liveboard/releases/current`。

首次安装仍需写入默认 workspace 和首位最高管理员：

```bash
docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard-v0.1.1-linux-amd64 \
  --file /opt/liveboard-v0.1.1-linux-amd64/docker-compose.yml \
  exec api node prisma/seed.cjs
```

随后立即使用 `admin / liveboard-admin` 登录并修改密码，再删除或停用其他演示账号。生产环境不得重复把 seed 当作常规部署步骤。

应用回滚可以重新解压并运行旧 Release 包中的 `deploy.sh`，或者在仓库部署模式下执行：

```bash
sh scripts/deploy-release.sh v0.1.0
```

每次部署都会先备份 PostgreSQL，但 Prisma migration 不会自动反向回滚；如果新版本已经执行不兼容的数据迁移，应使用经过验证的数据库恢复方案，而不是只切换旧镜像。

停止全部容器：

```bash
docker compose --project-name liveboard down
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

sh scripts/deploy-release.sh v0.1.1  # 从 GitHub Release 单文件离线包部署

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
- 确认 Compose 发布端口仍只绑定 `127.0.0.1`，公网安全组仅开放 SSH、HTTP 和 HTTPS。
- 使用 `pnpm deploy:prod` 在更新前生成数据库备份，并为 MinIO 配置独立备份。
- 中国内地服务器优先使用 GitHub Release 离线镜像部署，避免运行时依赖 Docker Hub。
- 为登录、上传和 AI 接口配置网关限流。
- 所有 schema 变更都提交 Prisma migration；生产环境由 `migrate` 服务自动执行 `prisma migrate deploy`，不使用 `db push`。

## 参与开发

1. 从 `main` 创建短生命周期分支。
2. 完成修改后运行 `pnpm validate`。
3. PR 中说明问题、方案、数据迁移、验证结果；涉及 UI 时附桌面端和移动端截图。
4. 不提交生成目录、本地数据或秘密配置。

面向开发代理的具体约定、历史决策和易错点维护在 [AGENTS.md](./AGENTS.md)。
