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

### HTTPS 依赖特定域名商或手工改配置

生产包现在离线携带固定版本并校验哈希的 ACME 客户端。最高管理员通过管理中心调用宿主机上受限的 HTTPS 助手，使用通用 HTTP-01 完成签发；API 容器只挂载专用 Unix Socket，不挂载 Docker Socket，也不以 root 运行。助手只接受状态、启用和续期三种操作，并对域名和邮箱做严格校验。

证书签发前先用公网域名回读随机验证文件，签发后再执行 Nginx 配置校验与本机 TLS 探测。只有全部成功才写入安全 Cookie 和域名来源配置；失败时恢复原 Nginx、环境和安装状态。systemd timer 每天进行带随机延迟的续期检查。

### HTTPS 助手沙箱与长请求超时

首个一键 HTTPS Release 将助手置于 `ProtectSystem=strict`，但只开放了 `/run/liveboard`。Ubuntu 的 `nginx -t` 即使已经确认配置语法正确，仍会打开 `/run/nginx.pid`，因此在助手沙箱内报只读文件系统错误。现在助手和续期 unit 都通过 `-/run/nginx.pid` 精确开放该文件，并用 `Requires=nginx.service` 保证测试时 Nginx 已运行；没有放宽整个 `/run`。

同一次审计发现 ACME 最长允许执行 240 秒，而旧 Nginx API 超时只有 150 秒、API Socket 超时只有 300 秒，可能出现后台最终成功但浏览器先收到超时。现在 Nginx 为 480 秒、Socket 为 420 秒，切换 HTTPS 地址前等待 12 秒让 API/Web 完成重建。升级只替换 LiveBoard 管理配置中精确匹配的旧超时行。

### 生产误用 demo seed

旧教程要求手工执行 demo seed，生产数据库会出现四个固定密码账号、演示权限组和演示内容，且每次部署都重复提示。现在生产使用独立 bootstrap：仅在空数据库创建一个随机密码最高管理员、默认 workspace 和论坛分类；demo seed 只服务本地开发。

## 保留的实现及原因

- 保留 `apps/api/prisma/seed.cjs`：本地开发仍需要完整演示数据和快捷账号。
- 保留 Compose 中的 `build` 配置：开发者仍需从源码验证生产镜像，但 Release 部署始终使用 `--no-build`。
- 保留 `NEXT_PUBLIC_API_URL=/api` 的构建参数：浏览器端变量会写入 Web 构建产物，相对路径是 IP 与域名反向代理共用的稳定方案。
- 保留命名卷和迁移前 PostgreSQL 备份；MinIO 继续要求独立卷快照或对象存储备份。
- 保留 `globals.css` 与 `redesign.css` 的现有加载关系。两者存在历史覆盖，但仍被全站使用，不能仅凭文件名或重复选择器判定为无用；后续应按路由逐步迁移，而不是在部署清理中冒险删除。

## 最终生产边界

- 唯一发布资产：`liveboard-<version>-linux-amd64.run` 自解压包。
- 正式安装入口：`sudo sh <包> install`；升级入口：`sudo sh <包> upgrade`。
- 安装完成后的日常运维统一使用 `/usr/local/bin/liveboard`。
- 稳定状态目录：`/opt/liveboard`。
- 当前版本软链接：`/opt/liveboard/releases/active`。
- 生产初始化：自动 bootstrap，不运行 demo seed。
- 公网入口：Nginx；容器端口只绑定 `127.0.0.1`。
- HTTP 与 HTTPS Cookie 策略通过 `SESSION_COOKIE_SECURE` 明确区分。
- 域名 HTTPS 使用提供商无关的 ACME HTTP-01；证书和助手状态位于 `/opt/liveboard/https`，升级不得清理。
