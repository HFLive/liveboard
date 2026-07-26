# Ubuntu 24.04 一键部署教程

本教程适用于 Ubuntu Server 24.04、Linux AMD64。服务器不需要 Git、Node.js、pnpm，也不需要访问 Docker Hub；在电脑下载一个 Release 自解压包并上传即可。

教程默认通过服务器公网 IP 和 HTTP 访问，不配置域名或服务器防火墙。HTTP 不加密传输，只适合首次安装、测试或受信任网络；长期公网使用应再配置 HTTPS。

## 1. 云安全组

在云服务器控制台添加入方向规则：

| 协议 | 端口 | 来源            | 用途             |
| ---- | ---- | --------------- | ---------------- |
| TCP  | 22   | 你的固定公网 IP | SSH 登录         |
| TCP  | 80   | `0.0.0.0/0`     | 通过公网 IP 访问 |
| TCP  | 443  | `0.0.0.0/0`     | 域名 HTTPS 访问  |

不要开放 `3000`、`4000`、`5432`、`6379`、`9000` 或 `9001`。这些端口只绑定服务器本机。

## 2. 准备服务器

SSH 登录服务器，并确保当前账号可以使用 `sudo`。安装器会在全新的 Ubuntu 24.04 上自动安装 Nginx、Docker、Compose、curl 等基础依赖；应用镜像仍全部来自上传的离线包。

如果机器已经安装了 Docker，安装器会沿用现有 Docker。已有 Docker 但缺少 Compose 时，安装器不会混装另一个 Docker 发行版，而会要求从现有 Docker 软件源补装 Compose 插件。

## 3. 在电脑下载并上传单文件包

合并待发布代码并创建新标签后，等待 GitHub Actions 的 `Release` 工作流完成。以下用 `v0.3.0` 举例，实际操作时替换为 Release 页面上的最新版本。

可以直接用浏览器下载：

```text
liveboard-v0.3.0-linux-amd64.run
```

也可以在已登录 GitHub CLI 的电脑上执行：

```bash
gh release download v0.3.0 \
  --pattern 'liveboard-v0.3.0-linux-amd64.run' \
  --dir ~/Downloads/liveboard-v0.3.0
```

上传到服务器：

```bash
scp ~/Downloads/liveboard-v0.3.0/liveboard-v0.3.0-linux-amd64.run \
  root@服务器公网IP:/opt/
```

## 4. 安装

文件上传完成后，在服务器执行：

```bash
sudo sh /opt/liveboard-v0.3.0-linux-amd64.run install
```

安装器会自动完成：

- 校验发布包；
- 按需安装 Ubuntu 基础依赖；
- 生成 PostgreSQL、MinIO 和会话密钥；
- 将配置写入权限为 `600` 的 `/opt/liveboard/.env`；
- 导入离线镜像；
- 启动 PostgreSQL、Redis 和 MinIO；
- 备份 PostgreSQL；
- 执行 Prisma migration；
- 启动 API 和 Web；
- 等待 API 与 Web 都通过健康检查；
- 在空数据库中创建唯一的最高管理员和基础 workspace；
- 配置并检查 Nginx；
- 安装 HTTPS 助手与自动续期定时器；
- 安装固定的 `liveboard` 管理命令。

首次安装时，终端最后会用醒目的独立区块显示随机管理员账号和密码，同时将其保存到仅 root 可读、权限为 `600` 的文件：

```text
/opt/liveboard/initial-admin-credentials.txt
```

即使终端输出被滚屏覆盖，也可以执行 `cat /opt/liveboard/initial-admin-credentials.txt` 重新查看。首次登录并修改密码后，应按文件内提示删除该明文凭据。升级已有系统时会检测现有最高管理员，不会生成、显示或覆盖管理员密码。

不要重复执行 demo seed。生产部署不会创建 `author`、`lecturer`、`learner` 等演示账号或演示内容。

## 5. 启用公网 IP 访问

浏览器明确打开：

```text
http://服务器公网IP
```

安装器会启用包内的 HTTP Nginx 配置，并将 `SESSION_COOKIE_SECURE` 设为 `false`，因此通过公网 IP 登录不会因为浏览器拒绝 Secure Cookie 而停留在登录页。

## 6. 检查状态

```bash
curl http://127.0.0.1:4000/health
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1
liveboard status
liveboard doctor
```

API 应返回 `"ok":true`，Web 和 Nginx 应返回 HTTP 200，PostgreSQL、API、Web 应显示健康。

如果服务器内部均返回 200，但公网仍无法访问，检查云安全组是否确实为当前实例开放 TCP 80，并确认浏览器使用的是 `http://` 而非 `https://`。

## 7. 升级

在电脑下载并上传新版 `.run` 单文件包，然后在服务器执行：

```bash
sudo sh /opt/liveboard-v0.3.1-linux-amd64.run upgrade
```

升级会继续使用：

- `/opt/liveboard/.env` 中的原有密钥；
- `liveboard` Compose 项目的原有命名卷；
- `/opt/liveboard/backups/` 中的 PostgreSQL 备份；
- 现有管理员、用户和业务数据。

升级不会覆盖现有 LiveBoard Nginx 配置。不要执行 `docker compose down -v`，也不要在升级时运行 demo seed。

清理旧版本：

```bash
liveboard clean --dry-run
liveboard clean
```

默认保留当前和上一个版本。需要同时删除 `/opt` 中的旧安装包时使用：

```bash
liveboard clean --packages
```

## 8. 常用排查

```bash
liveboard status
liveboard doctor
liveboard logs api web
```

停止或重启应用：

```bash
liveboard stop
liveboard start
liveboard restart
```

可恢复卸载：

```bash
liveboard uninstall
```

卸载会移除应用容器、应用镜像、版本目录并禁用 Nginx 站点，但保留 `/opt/liveboard/.env`、备份以及 PostgreSQL、Redis、MinIO 数据卷。重新上传发布包并执行 `install` 可恢复原数据。

## 9. 改用 HTTPS

该功能使用标准 ACME HTTP-01，适用于任意域名注册商和权威 DNS 服务商，不要求使用 Cloudflare API。

启用前确认：

1. 域名的 A 记录指向这台服务器的公网 IPv4；只有服务器确实配置了公网 IPv6 时才添加 AAAA 记录。
2. 公网 TCP 80 和 443 均已放行。
3. `http://你的域名` 能到达本机 LiveBoard。首次签发时不要在 CDN 侧强制跳转 HTTPS；使用 Cloudflare 代理时，如检查失败可先切到“仅 DNS”完成首次签发。

然后以最高管理员进入“管理中心 → 系统设置 → HTTPS”，填写完整域名和证书通知邮箱，点击“检查并启用 HTTPS”。系统会依次完成公网验证、证书签发、Nginx 校验、本机 HTTPS 探测和应用安全 Cookie 切换。任一步失败都会恢复原 HTTP 配置，不会用半成品证书替换当前站点。

也可以通过服务器命令启用：

```bash
sudo liveboard https status
sudo liveboard https enable \
  --domain board.example.com \
  --email admin@example.com
```

启用成功后：

- HTTP 自动跳转 HTTPS；
- `/opt/liveboard/.env` 中的 `SESSION_COOKIE_SECURE` 和 `WEB_ORIGIN` 自动更新；
- `liveboard-https-renew.timer` 每天检查一次证书，并在需要时续期和重新载入 Nginx；
- 证书及续期状态保存在 `/opt/liveboard/https`，升级不会覆盖。

HTTPS 签发可能持续数分钟。LiveBoard 管理的 Nginx API 读写超时为 480 秒，API 与宿主机助手的 Socket 超时为 420 秒；升级器只会将带 `# Managed by LiveBoard` 标记的旧配置中精确的 `150s` 值迁移为 `480s`，不会覆盖其他 Nginx 自定义内容。首次配置如果经过带短请求时限的 CDN 代理，建议临时使用“仅 DNS”直连源站。

手动检查或立即执行续期：

```bash
sudo liveboard https status
sudo liveboard https renew
systemctl status liveboard-https-renew.timer
```

当前一键流程只签发单个完整域名，不签发泛域名证书；泛域名必须使用依赖 DNS 服务商 API 的 DNS-01，不属于这套通用流程。HTTPS 只解决传输加密，不改变服务器所在地相关的域名备案或接入要求。

Ubuntu 24.04 官方仓库提供 [`docker.io`](https://packages.ubuntu.com/noble/docker.io) 和 [`docker-compose-v2`](https://packages.ubuntu.com/noble/docker-compose-v2)；Nginx 的安装方式可参考 [Ubuntu Server 官方文档](https://documentation.ubuntu.com/server/how-to/web-services/install-nginx/)。
