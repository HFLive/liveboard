# LiveBoard Mobile

Expo + React Native 客户端，与现有 NestJS API 共用同一套后端。Android 是当前开发目标；iOS 工程配置已保留，后续可以直接 `expo prebuild -p ios`。

## 运行

先启动基础设施和 API：

```bash
pnpm infra:up
pnpm dev:api
```

再启动移动端：

```bash
pnpm dev:mobile
```

用 Expo Go 打开 Android 设备或模拟器。真机请把服务器地址填成电脑的局域网 IP，例如 `http://192.168.1.8:4000`。Android 模拟器访问开发机请用 `http://10.0.2.2:4000`，不要用 `localhost`。

## 认证

Web 继续使用 HttpOnly Cookie。移动端登录时发送 `X-LiveBoard-Client: mobile`，API 会在 JSON 中额外返回 `sessionToken`（与 Cookie 同一份 HMAC 会话值）。之后请求使用 `Authorization: Bearer <sessionToken>`，会话仍受 `sessionVersion` 约束。Token 存在 `expo-secure-store`。

## 当前范围

已覆盖：服务器地址、登录/登出、课堂、文档阅读、在线练习、文件查看与上传、论坛、AI 对话。文档编辑、课件制作和管理中心仍使用 Web。
