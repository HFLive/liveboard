# Ubuntu 24.04 单文件部署教程

本教程适用于 Linux AMD64 的 Ubuntu Server 24.04。服务器不需要安装 Git、Node.js 或 pnpm，不需要访问 Docker Hub，也不配置域名；部署完成后直接使用服务器公网 IP 访问。

> 本教程使用 HTTP，适合首次安装、测试或受信任网络。正式公网长期使用仍建议后续增加 HTTPS，否则登录信息和业务数据不会被传输加密。

## 1. 配置云安全组

在云服务器控制台添加入方向规则：

| 协议 | 端口 | 来源            | 用途                         |
| ---- | ---- | --------------- | ---------------------------- |
| TCP  | 22   | 你的固定公网 IP | SSH 登录                     |
| TCP  | 80   | `0.0.0.0/0`     | 使用服务器 IP 访问 LiveBoard |

不要开放 `3000`、`4000`、`5432`、`6379`、`9000` 或 `9001`。这些端口只绑定服务器本机。

本教程不配置 UFW 或其他服务器防火墙。

## 2. 安装 Docker 和 Nginx

SSH 登录服务器后保持 root shell，执行：

```bash
apt update
apt install -y docker.io docker-compose-v2 nginx curl ca-certificates tar gzip coreutils
systemctl enable --now docker
systemctl enable --now nginx
```

确认安装成功：

```bash
docker version
docker compose version
nginx -v
```

这里使用 Ubuntu 24.04 自带的 `docker.io` 和 `docker-compose-v2`，不添加 Docker 官方软件源，也不访问 `download.docker.com`。

## 3. 在电脑下载并上传发布包

在 GitHub Release 页面下载对应版本的单个 Linux AMD64 文件，例如：

```text
liveboard-v0.1.2-linux-amd64.tar.gz
```

也可以在已经登录 GitHub CLI 的电脑上执行：

```bash
gh release download v0.1.2 \
  --pattern 'liveboard-v0.1.2-linux-amd64.tar.gz' \
  --dir ~/Downloads/liveboard-v0.1.2
```

从电脑上传到服务器：

```bash
scp ~/Downloads/liveboard-v0.1.2/liveboard-v0.1.2-linux-amd64.tar.gz \
  root@服务器公网IP:/opt/
```

## 4. 解压并启动 LiveBoard

回到服务器执行：

```bash
cd /opt
tar -xzf liveboard-v0.1.2-linux-amd64.tar.gz
cd liveboard-v0.1.2-linux-amd64
sh deploy.sh
```

第一次运行会自动完成以下工作：

- 创建 `/opt/liveboard/.env`；
- 自动生成 PostgreSQL 密码；
- 自动生成 MinIO 密码；
- 自动生成会话签名密钥；
- 校验发布包内文件；
- 导入全部离线 Docker 镜像；
- 启动 PostgreSQL、Redis 和 MinIO；
- 备份数据库并执行 Prisma migration；
- 启动 API 和 Web 并等待健康检查。

随机值不会显示在终端中，配置文件权限会设置为 `600`。正常情况下不需要编辑 `.env`，也不需要再次运行部署命令。

## 5. 启用 IP 访问

发布包已经包含不需要域名的 Nginx 配置。在当前目录执行：

```bash
cp nginx.conf /etc/nginx/sites-available/liveboard
ln -sfn /etc/nginx/sites-available/liveboard /etc/nginx/sites-enabled/liveboard
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx
```

现在可以在电脑浏览器打开：

```text
http://服务器公网IP
```

## 6. 首次写入系统数据

只在第一次安装时执行一次：

```bash
docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard/releases/active \
  --file /opt/liveboard/releases/active/docker-compose.yml \
  exec api node prisma/seed.cjs
```

随后使用以下账号登录：

```text
账号：admin
密码：liveboard-admin
```

登录后立即修改管理员密码，并删除或停用不需要的演示账号。不要在升级时重复执行 seed。

## 7. 检查运行状态

```bash
curl http://127.0.0.1:4000/health
curl -I http://127.0.0.1
docker compose \
  --project-name liveboard \
  --project-directory /opt/liveboard/releases/active \
  --file /opt/liveboard/releases/active/docker-compose.yml \
  ps
```

API 健康检查应返回成功，容器状态中 PostgreSQL、API 和 Web 应为健康状态。

## 8. 升级

在电脑下载并上传新版本的单个压缩包，然后在服务器执行：

```bash
cd /opt
tar -xzf liveboard-v0.1.3-linux-amd64.tar.gz
cd liveboard-v0.1.3-linux-amd64
sh deploy.sh
```

升级会继续使用 `/opt/liveboard/.env` 和原有 Docker 数据卷，并在迁移前将 PostgreSQL 备份到 `/opt/liveboard/backups/`。不要执行 `docker compose down -v`。

如果新版本包含 Nginx 配置更新，再执行：

```bash
cp nginx.conf /etc/nginx/sites-available/liveboard
nginx -t
systemctl reload nginx
```

## 9. 常用排查命令

```bash
docker compose --project-name liveboard --project-directory /opt/liveboard/releases/active --file /opt/liveboard/releases/active/docker-compose.yml ps
docker compose --project-name liveboard --project-directory /opt/liveboard/releases/active --file /opt/liveboard/releases/active/docker-compose.yml logs --tail=100 api web
systemctl status docker --no-pager
systemctl status nginx --no-pager
```

停止应用但保留全部数据：

```bash
docker compose --project-name liveboard --project-directory /opt/liveboard/releases/active --file /opt/liveboard/releases/active/docker-compose.yml down
```

再次启动当前版本：

```bash
cd /opt/liveboard-v0.1.2-linux-amd64
sh deploy.sh
```

Ubuntu 24.04 官方仓库提供 [`docker.io`](https://packages.ubuntu.com/noble/docker.io) 和 [`docker-compose-v2`](https://packages.ubuntu.com/noble/docker-compose-v2)；Nginx 的安装和站点配置方式可参考 [Ubuntu Server 官方文档](https://documentation.ubuntu.com/server/how-to/web-services/install-nginx/)。
