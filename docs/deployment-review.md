# 生产部署链路复盘

## 演进过程

生产部署在实际上线过程中经历了三条路线：

1. 服务器拉取源码并现场构建镜像；
2. GitHub Release 发布四个文件，服务器分别下载并导入；
3. 电脑下载一个自包含 Release 包，上传服务器后本地部署。

前两条路线分别依赖服务器访问 GitHub、Docker Hub、npm registry 或多个 Release 资产，在中国内地网络中不稳定，也让仓库长期维护三套相似的备份、迁移和健康检查逻辑。最终确认第三条路线为唯一正式生产流程。

## 已删除的遗留实现

- 删除 `scripts/deploy.sh`：不再支持服务器拉源码并现场构建的正式生产流程。
- 删除 `scripts/deploy-release.sh`：不再支持服务器直接下载 Release。
- 删除 v0.1.0 四文件 Release 的下载、校验和兼容代码。
- 删除 `pnpm deploy:prod`，避免开发者误走已经弃用的生产路径。
- README 删除并列的多套部署教程，只保留单文件 Release 入口。

这些删除不影响本地开发。本地仍使用 `pnpm infra:up`、`pnpm dev` 和 demo seed；需要从源码验证生产容器时仍可手工执行 `docker compose up --build -d`。

## 实际部署暴露并修复的问题

### Docker 包冲突

已有 Docker 官方 `containerd.io` 的服务器不能再混装 Ubuntu `docker.io`，否则会与 `containerd` 冲突。新教程要求先运行 `docker --version` 和 `docker compose version`；已安装可用 Docker 时只安装 Nginx 等基础工具。

### 旧 `.env` 阻断部署

早期安装留下的 `/opt/liveboard/.env` 可能包含 `NODE_ENV=development`。部署脚本现在会将其收敛为 `production`，而不是要求用户手工修改后重跑。

### HTTP 登录 Cookie 被浏览器拒绝

生产 API 原先仅根据 `NODE_ENV=production` 强制设置 Secure Cookie，导致通过 HTTP 公网 IP 登录时浏览器拒绝保存会话。现在由 `SESSION_COOKIE_SECURE` 显式控制：HTTP IP 包为 `false`，HTTPS 环境必须设为 `true`。

### 脚本过早宣布完成

旧脚本只等待 API 健康，Web 仍处于 `health: starting` 时就报告部署完成，容易诱导用户重复执行。现在 API 和 Web 都通过健康检查后才完成。

### 生产误用 demo seed

旧教程要求手工执行 demo seed，生产数据库会出现四个固定密码账号、演示权限组和演示内容，且每次部署都重复提示。现在生产使用独立 bootstrap：仅在空数据库创建一个随机密码最高管理员、默认 workspace 和论坛分类；demo seed 只服务本地开发。

## 保留的实现及原因

- 保留 `apps/api/prisma/seed.cjs`：本地开发仍需要完整演示数据和快捷账号。
- 保留 Compose 中的 `build` 配置：开发者仍需从源码验证生产镜像，但 Release 部署始终使用 `--no-build`。
- 保留 `NEXT_PUBLIC_API_URL=/api` 的构建参数：浏览器端变量会写入 Web 构建产物，相对路径是 IP 与域名反向代理共用的稳定方案。
- 保留命名卷和迁移前 PostgreSQL 备份；MinIO 继续要求独立卷快照或对象存储备份。
- 保留 `globals.css` 与 `redesign.css` 的现有加载关系。两者存在历史覆盖，但仍被全站使用，不能仅凭文件名或重复选择器判定为无用；后续应按路由逐步迁移，而不是在部署清理中冒险删除。

## 最终生产边界

- 唯一发布资产：`liveboard-<version>-linux-amd64.tar.gz`。
- 唯一正式安装入口：包内 `deploy.sh`。
- 稳定状态目录：`/opt/liveboard`。
- 当前版本软链接：`/opt/liveboard/releases/active`。
- 生产初始化：自动 bootstrap，不运行 demo seed。
- 公网入口：Nginx；容器端口只绑定 `127.0.0.1`。
- HTTP 与 HTTPS Cookie 策略通过 `SESSION_COOKIE_SECURE` 明确区分。
