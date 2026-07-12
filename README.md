# LiveBoard

LiveBoard 是面向教学资料沉淀、课程组织、现场演示、练习反馈和团队讨论的自托管工作台。本仓库采用 pnpm workspace 管理 Next.js、NestJS 与共享 TypeScript 包。

本文件是项目唯一的长期说明文档。架构约定、开发流程、部署说明和协作规范都维护在这里，避免多份文档互相失效。

## 产品范围

- AI 助手：基于用户有权访问的课程内容回答问题。
- 课程内容：按文件夹管理文档、课程、教案与块内容。
- 素材库：上传、预览和追踪附件引用。
- 练习：创建题目、提交答案、自动评分与人工批阅。
- 讨论：版块、主题、回复与管理能力。
- 管理中心：成员、容量、权限组、论坛、AI 与系统设置。

系统角色只有 `admin` 和 `member`。具体内容能力由权限组和目标资源上的 `owner`、`editor`、`lecturer`、`viewer`、`no_access` 决定；后端权限检查是最终安全边界。

## 仓库结构

```text
liveboard/
├── apps/
│   ├── api/                  # NestJS API、Prisma schema 与种子数据
│   │   └── src/
│   │       ├── app.module.ts
│   │       ├── common/       # 跨模块后端工具
│   │       └── modules/      # 按业务域组织的模块
│   └── web/                  # Next.js App Router 前端
│       ├── app/              # 只放路由、布局和路由专属组件
│       ├── components/       # 跨路由共享组件
│       └── lib/              # API 客户端、路由和格式化工具
├── packages/
│   └── shared/               # 前后端共享类型与纯函数
├── infra/
│   └── nginx/                # 反向代理配置
├── docker-compose.yml        # PostgreSQL、Redis、MinIO、API、Web
└── README.md                 # 唯一项目说明
```

生成目录不进入版本控制，包括 `node_modules`、`.next*`、`dist`、覆盖率文件、TypeScript 增量缓存和本地 pnpm store。

## 命名与分层约定

- React 组件和文件使用 `PascalCase`，例如 `ExerciseRunner.tsx`。
- 普通 TypeScript 文件使用 `kebab-case`，框架约定文件保留 `page.tsx`、`layout.tsx`、`*.module.ts`、`*.service.ts` 等形式。
- 路由专属组件与对应 `page.tsx` 放在同一业务目录；跨路由组件放在 `apps/web/components`。
- API 模块按 `modules/<domain>` 组织，DTO 使用 `<domain>.dto.ts`，避免含义不明的 `dto.ts`。
- 前端地址统一从 `apps/web/lib/routes.ts` 获取，业务组件不直接拼接应用 URL。
- API 调用统一通过 `apps/web/lib/api`，页面组件不直接调用 `fetch`。
- 共享包只放无运行环境依赖的类型、权限和评分逻辑。

## 页面地址

| 功能     | 地址                       |
| -------- | -------------------------- |
| AI 助手  | `/app/ai`                  |
| 课程内容 | `/app/content`             |
| 内容编辑 | `/app/content/:id`         |
| 演示模式 | `/app/content/:id/present` |
| 素材库   | `/app/library`             |
| 练习     | `/app/exercises`           |
| 讨论     | `/app/forum`               |
| 管理中心 | `/app/admin`               |
| 个人设置 | `/app/profile`             |

`/app` 会跳转到 `/app/ai`。旧版 `/app/files` 地址保留兼容跳转，外部书签不会立即失效。

## 本地开发

### 环境要求

- Node.js 22 LTS
- pnpm 11.7
- Docker Desktop
- macOS、Linux，或 Windows + WSL2

### 首次启动

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm db:generate
pnpm db:sync
pnpm db:seed
pnpm dev
```

开发地址：

- Web：<http://localhost:3000>
- API 健康检查：<http://localhost:4000/health>
- MinIO API：<http://localhost:9000>
- MinIO 控制台：<http://localhost:9001>
- PostgreSQL：`localhost:5432`
- Redis：`localhost:6379`

只启动单个应用：

```bash
pnpm dev:web
pnpm dev:api
```

### 演示账号

种子数据默认创建以下本地账号：

| 账号       | 密码                 | 用途       |
| ---------- | -------------------- | ---------- |
| `admin`    | `liveboard-admin`    | 管理员     |
| `author`   | `liveboard-author`   | 内容维护   |
| `lecturer` | `liveboard-lecturer` | 授课与批阅 |
| `learner`  | `liveboard-learner`  | 学习与提交 |

这些账号只能用于本地演示。生产环境必须删除或修改默认账号，并关闭 `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS`。该变量会在 Web 构建时写入前端产物；修改后需要重新执行 `docker compose build web`，仅重启容器不会更新登录页。

## 环境变量

以 `.env.example` 为模板。关键变量：

| 变量                             | 说明                                                |
| -------------------------------- | --------------------------------------------------- |
| `WEB_ORIGIN`                     | 允许携带凭据访问 API 的前端来源；多个来源用逗号分隔 |
| `NEXT_PUBLIC_API_URL`            | 浏览器访问 API 的公开地址                           |
| `DATABASE_URL`                   | PostgreSQL 连接地址                                 |
| `REDIS_URL`                      | Redis 连接地址                                      |
| `SESSION_SECRET`                 | 会话签名密钥，生产环境必须使用随机长字符串          |
| `MINIO_*`                        | MinIO 地址、凭据和 bucket                           |
| `NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS` | 是否在登录页显示演示账号                            |

不要提交 `.env`、真实密码、API Key、数据库备份或用户上传内容。

## 数据库命令

```bash
pnpm db:generate  # 生成 Prisma Client
pnpm db:sync      # 本地开发同步 schema
pnpm db:migrate   # 创建并执行正式 migration
pnpm db:seed      # 重建本地演示数据
```

跨团队开发时，涉及数据模型的提交应包含 Prisma migration；`db:sync` 只用于本地快速迭代。

## 质量检查

提交前至少运行：

```bash
pnpm format
pnpm typecheck
pnpm test
pnpm build
```

一次执行全部检查：

```bash
pnpm validate
```

测试重点：

- `packages/shared`：评分和权限纯函数。
- `apps/api`：业务服务、权限边界和接口行为。
- `apps/web`：关键路由、表单、移动端和浏览器交互。

新增功能应优先补充与业务规则同层的测试，不要只依赖手工页面检查。

## Docker

只启动基础依赖：

```bash
pnpm infra:up
```

构建并启动完整服务：

```bash
docker compose up --build -d
docker compose ps
```

停止服务：

```bash
pnpm infra:down
```

Compose 中的服务名是容器网络地址：API 使用 `postgres`、`redis` 和 `minio`，不要在容器内使用 `localhost` 连接其他容器。

## 架构说明

```text
Browser
  └── Next.js Web :3000
        └── NestJS API :4000
              ├── PostgreSQL :5432
              ├── Redis :6379
              └── MinIO :9000
```

- 前端通过 HttpOnly Cookie 登录，浏览器请求统一携带凭据。
- 会话值使用 HMAC 签名并包含服务端校验的有效期。
- 文件查询、素材下载、练习与管理接口都必须在服务层校验当前用户。
- 文件内容使用块结构，演示模式根据一级、二级标题拆分幻灯片。
- 生产环境不依赖远程字体、第三方身份服务或外部对象存储。

## 安全与生产要求

- `NODE_ENV=production` 时必须配置非默认 `SESSION_SECRET`。
- 替换 PostgreSQL、MinIO 和种子账号的默认密码。
- HTTPS 终止后保持 Cookie 的 `Secure` 属性。
- 通过 Nginx 或网关限制登录、上传和 AI 接口频率。
- 数据库、MinIO 数据与环境变量需要独立备份。
- API 和存储端口在生产环境不直接暴露到公网。
- AI 服务地址由管理员配置；只使用受信任的模型端点。

## 团队协作与 GitHub

建议使用短生命周期分支：

1. 从主分支创建 `feat/<topic>`、`fix/<topic>` 或 `refactor/<topic>`。
2. 一个提交只处理一个清晰主题，避免混入生成产物。
3. PR 描述包含问题、方案、数据迁移、验证结果和界面截图。
4. 合并前通过 `pnpm validate`，涉及页面时补充桌面端和移动端验证。
5. 重大架构约定直接更新本 README，不再新增平行说明文档。

首次推送 GitHub 前应确认：

- `.env`、本地数据、构建目录和系统文件均未被跟踪。
- 默认密钥与演示密码没有用于生产。
- 仓库已设置许可证、分支保护和必需检查。
- CI 至少执行依赖安装、类型检查、测试和构建。

## 维护原则

- 先保证权限和数据正确，再优化展示体验。
- 保持路由、导航名称和页面内容语义一致。
- 删除废弃实现时同时删除兼容代码、样式和说明。
- 避免在组件中散落地址、角色文字和状态文字。
- 优先使用可测试的纯函数和并行查询，避免不必要的串行数据库请求。
