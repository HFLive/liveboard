# Ubuntu 24.04 单文件部署教程

本教程适用于 Ubuntu Server 24.04、Linux AMD64。服务器不需要 Git、Node.js、pnpm，也不需要访问 Docker Hub；在电脑下载一个 Release 压缩包并上传即可。

教程默认通过服务器公网 IP 和 HTTP 访问，不配置域名或服务器防火墙。HTTP 不加密传输，只适合首次安装、测试或受信任网络；长期公网使用应再配置 HTTPS。

## 1. 云安全组

在云服务器控制台添加入方向规则：

| 协议 | 端口 | 来源            | 用途             |
| ---- | ---- | --------------- | ---------------- |
| TCP  | 22   | 你的固定公网 IP | SSH 登录         |
| TCP  | 80   | `0.0.0.0/0`     | 通过公网 IP 访问 |

不要开放 `3000`、`4000`、`5432`、`6379`、`9000` 或 `9001`。这些端口只绑定服务器本机。

## 2. 检查 Docker，安装基础软件

SSH 登录服务器并保持 root shell。先检查机器是否已经安装 Docker：

```bash
docker --version
docker compose version
```

如果两条命令都成功，不要再安装 `docker.io` 或 `docker-compose-v2`。直接安装其余软件：

```bash
apt update
apt install -y nginx curl ca-certificates tar gzip coreutils
systemctl enable --now docker
systemctl enable --now nginx
```

如果是从未安装过 Docker 的全新 Ubuntu 24.04，使用 Ubuntu 仓库安装：

```bash
apt update
apt install -y docker.io docker-compose-v2 nginx curl ca-certificates tar gzip coreutils
systemctl enable --now docker
systemctl enable --now nginx
```

如果系统已有 `docker-ce`、`docker-ce-cli` 或 `containerd.io`，不要混装 Ubuntu 的 `docker.io`。已有 Docker 但缺少 Compose 时，应安装同一 Docker 软件源中的 `docker-compose-plugin`。

最终确认：

```bash
docker version
docker compose version
nginx -v
```

## 3. 在电脑下载并上传单文件包

合并待发布代码并创建新标签后，等待 GitHub Actions 的 `Release` 工作流完成。以下用 `v0.1.3` 举例，实际操作时替换为 Release 页面上的最新版本。

可以直接用浏览器下载：

```text
liveboard-v0.1.3-linux-amd64.tar.gz
```

也可以在已登录 GitHub CLI 的电脑上执行：

```bash
gh release download v0.1.3 \
  --pattern 'liveboard-v0.1.3-linux-amd64.tar.gz' \
  --dir ~/Downloads/liveboard-v0.1.3
```

上传到服务器：

```bash
scp ~/Downloads/liveboard-v0.1.3/liveboard-v0.1.3-linux-amd64.tar.gz \
  root@服务器公网IP:/opt/
```

## 4. 解压并部署

在服务器执行：

```bash
cd /opt
tar -xzf liveboard-v0.1.3-linux-amd64.tar.gz
cd liveboard-v0.1.3-linux-amd64
sh deploy.sh
```

脚本会自动完成：

- 校验发布包；
- 生成 PostgreSQL、MinIO 和会话密钥；
- 将配置写入权限为 `600` 的 `/opt/liveboard/.env`；
- 导入离线镜像；
- 启动 PostgreSQL、Redis 和 MinIO；
- 备份 PostgreSQL；
- 执行 Prisma migration；
- 启动 API 和 Web；
- 等待 API 与 Web 都通过健康检查；
- 在空数据库中创建唯一的最高管理员和基础 workspace。

首次安装时，终端最后会用醒目的独立区块显示随机管理员账号和密码，同时将其保存到仅 root 可读、权限为 `600` 的文件：

```text
/opt/liveboard/initial-admin-credentials.txt
```

即使终端输出被滚屏覆盖，也可以执行 `cat /opt/liveboard/initial-admin-credentials.txt` 重新查看。首次登录并修改密码后，应按文件内提示删除该明文凭据。升级已有系统时会检测现有最高管理员，不会生成、显示或覆盖管理员密码。

不要重复执行 demo seed。生产部署不会创建 `author`、`lecturer`、`learner` 等演示账号或演示内容。

## 5. 启用公网 IP 访问

仍在解压后的版本目录中执行：

```bash
cp nginx.conf /etc/nginx/sites-available/liveboard
ln -sfn /etc/nginx/sites-available/liveboard /etc/nginx/sites-enabled/liveboard
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

浏览器明确打开：

```text
http://服务器公网IP
```

发布包的 HTTP 配置会将 `SESSION_COOKIE_SECURE` 设为 `false`，因此通过公网 IP 登录不会再因为浏览器拒绝 Secure Cookie 而停留在登录页。

## 6. 检查状态

```bash
curl http://127.0.0.1:4000/health
curl -I http://127.0.0.1:3000
curl -I http://127.0.0.1

docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard/releases/active \
  --file /opt/liveboard/releases/active/docker-compose.yml \
  ps
```

API 应返回 `"ok":true`，Web 和 Nginx 应返回 HTTP 200，PostgreSQL、API、Web 应显示健康。

如果服务器内部均返回 200，但公网仍无法访问，检查云安全组是否确实为当前实例开放 TCP 80，并确认浏览器使用的是 `http://` 而非 `https://`。

## 7. 升级

在电脑下载并上传新版单文件包，然后在服务器执行：

```bash
cd /opt
tar -xzf liveboard-v0.1.4-linux-amd64.tar.gz
cd liveboard-v0.1.4-linux-amd64
sh deploy.sh
```

升级会继续使用：

- `/opt/liveboard/.env` 中的原有密钥；
- `liveboard` Compose 项目的原有命名卷；
- `/opt/liveboard/backups/` 中的 PostgreSQL 备份；
- 现有管理员、用户和业务数据。

每次升级都同步包内 Nginx 配置：

```bash
cp nginx.conf /etc/nginx/sites-available/liveboard
nginx -t
systemctl reload nginx
```

不要执行 `docker compose down -v`，也不要在升级时运行 demo seed。

## 8. 常用排查

```bash
docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard/releases/active \
  --file /opt/liveboard/releases/active/docker-compose.yml \
  logs --tail=100 api web

systemctl status docker --no-pager
systemctl status nginx --no-pager
tail -n 100 /var/log/nginx/error.log
```

停止应用但保留数据：

```bash
docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard/releases/active \
  --file /opt/liveboard/releases/active/docker-compose.yml \
  down
```

重新部署当前版本：

```bash
cd /opt/liveboard/releases/active
sh deploy.sh
```

## 9. 改用 HTTPS

配置域名和 HTTPS 后，将 `/opt/liveboard/.env` 中的配置改为：

```text
SESSION_COOKIE_SECURE=true
```

随后重新运行当前版本的 `sh deploy.sh`，并使用支持 HTTPS 的 Nginx 配置。不要在纯 HTTP 环境中启用该值。

Ubuntu 24.04 官方仓库提供 [`docker.io`](https://packages.ubuntu.com/noble/docker.io) 和 [`docker-compose-v2`](https://packages.ubuntu.com/noble/docker-compose-v2)；Nginx 的安装方式可参考 [Ubuntu Server 官方文档](https://documentation.ubuntu.com/server/how-to/web-services/install-nginx/)。
