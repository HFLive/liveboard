# 文档编辑 MCP

外部 AI 工具（Claude Desktop、Claude Code 等）通过 [MCP（Model Context Protocol）](https://modelcontextprotocol.io) 以某个 LiveBoard 用户身份读取和编辑文档。

MCP 服务器由 API 提供（`POST/GET /mcp`，Streamable HTTP，无状态），自托管与 Vercel 两种部署形态都可用；另提供本地 stdio 入口。

## 能力范围（v1）

12 个工具：文件夹树/文件列表/文件详情/内容块列表，创建/更新/发布/删除文件，创建/更新/删除/重排内容块。

v1 **不含**：Markdown 导入导出、全文搜索、附件上传（`image`/`attachment` 块只能引用工作区内已上传的附件，需先在 Web 端上传）。

## 配置

| 环境变量      | 默认值 | 说明                                         |
| ------------- | ------ | -------------------------------------------- |
| `MCP_ENABLED` | `true` | 设为 `false` 可一键关闭 MCP 端点（返回 404） |

无需新增部署配置：HTTP 端点复用 API 端口（自托管 `API_PORT`，Vercel 同一函数）。

stdio 入口需要 `MCP_STDIO_USER_ID`（见下文）。

## 个人访问令牌（PAT）

MCP 客户端无法携带浏览器 cookie，因此使用独立的个人访问令牌（PAT）认证：

- 请求头 `Authorization: Bearer lbt_...`
- 数据库只存 SHA-256 哈希，**明文只在创建时显示一次**，请立即保存
- 令牌挂在一个具体用户下，权限与 Web 端完全一致（含 lecturer 特例）
- 默认不过期，可手动撤销；创建时可指定 `expiresAt`

### 创建（Web 管理界面）

管理员（含最高管理员）登录后在 **管理中心 → 访问令牌**（`/app/admin/api-tokens`）创建、复制与撤销令牌。

### 创建（CLI）

```bash
pnpm --filter @liveboard/api api-token:create -- --user admin --name claude-code
# 可选过期时间：
pnpm --filter @liveboard/api api-token:create -- --user admin --name claude-code --expiresAt 2027-01-01T00:00:00Z
```

### 创建 / 列出 / 撤销（管理 API，需最高管理员 cookie 会话）

```bash
# 创建（明文只返回这一次）
curl -X POST <API>/admin/api-tokens \
  -H "Content-Type: application/json" -H "Cookie: liveboard_session=..." \
  -d '{"userId":"<userId>","name":"claude-code","expiresAt":"2027-01-01T00:00:00Z"}'

# 列出（不返回 tokenHash）
curl <API>/admin/api-tokens -H "Cookie: liveboard_session=..."

# 撤销（立即失效）
curl -X DELETE <API>/admin/api-tokens/<tokenId> -H "Cookie: liveboard_session=..."
```

建议为每个客户端单独建令牌，便于按名审计与撤销。

## 客户端配置

### HTTP（推荐，自托管与 Vercel 通用）

Claude Code：

```bash
claude mcp add liveboard --transport http --url https://<host>/mcp \
  --header "Authorization: Bearer lbt_..."
```

Claude Desktop 的 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "liveboard": {
      "type": "http",
      "url": "https://<host>/mcp",
      "headers": { "Authorization": "Bearer lbt_..." }
    }
  }
}
```

### stdio（本地直连，需 API 所在机器能访问数据库）

stdio 模式下本地进程即为信任边界，不再校验 PAT，操作者身份用 `MCP_STDIO_USER_ID` 环境变量指定（用户 id，可用 `pnpm --filter @liveboard/api api-token:create` 输出的 id，或查库获取）。未配置时所有工具返回 `[UNAUTHORIZED]`。

注意：stdio 入口必须运行编译产物（tsx 不发射装饰器元数据，Nest 依赖注入会失效），`mcp:stdio` 脚本内部会先 `nest build`。

```bash
claude mcp add --transport stdio liveboard \
  --env MCP_STDIO_USER_ID=<userId> \
  -- pnpm --filter @liveboard/api mcp:stdio
```

生产（已构建）：

```json
{
  "mcpServers": {
    "liveboard": {
      "command": "node",
      "args": ["/path/to/apps/api/dist/mcp-stdio.js"],
      "env": {
        "MCP_STDIO_USER_ID": "<userId>",
        "DATABASE_URL": "...",
        "SESSION_SECRET": "..."
      }
    }
  }
}
```

## 工具清单

| 工具               | 入参                                    | 说明                                           |
| ------------------ | --------------------------------------- | ---------------------------------------------- |
| `list_folder_tree` | —                                       | 当前用户可查看的文件夹树（含权限等级）         |
| `list_files`       | `folderId?`                             | 文件夹内文件与独立附件（草稿对 viewer 不可见） |
| `get_file`         | `fileId`                                | 文件详情（含 permission）                      |
| `list_blocks`      | `fileId`                                | 内容块列表（按顺序）                           |
| `create_file`      | `folderId, title, type?`                | 创建文件（需文件夹编辑/lecturer 权限）         |
| `update_file`      | `fileId, title?, folderId?`             | 改标题/移动（至少一项）                        |
| `publish_file`     | `fileId`                                | 发布（draft → published）                      |
| `delete_file`      | `fileId`                                | **硬删除**（连同内容块，不可恢复）             |
| `create_block`     | `fileId, type, dataJson, afterBlockId?` | 末尾/指定块后插入                              |
| `update_block`     | `blockId, type?, dataJson`              | 更新内容                                       |
| `delete_block`     | `blockId`                               | 删除内容块                                     |
| `reorder_blocks`   | `fileId, blockIds[]`                    | 全量重排                                       |

各块类型的 `dataJson` 结构（与 Web 编辑器一致，服务端校验）：

- `heading_1..6` / `paragraph` / `bulleted_list` / `numbered_list` / `todo` / `code` / `quote`：`{"text": "..."}`
- `divider`：`{}`
- `image` / `attachment`：`{"assetId": "..."}`（须引用工作区内附件）
- `bilibili`：`{"embedCode": "..."}`（≤5000 字符）
- `math`：`{"text": "..."}`（LaTeX，≤50000 字符）
- `table`：`{"rows": [["单元格", ...], ...]}`（1–50 行，每行 1–20 列）
- `question`：编辑器富结构对象（透传）

## 权限与错误语义

所有读写操作复用 Web 端的权限判定（`PermissionsService`），MCP 不引入第二条权限路径：

- 文档/文件夹可见性：按 `owner > editor > lecturer > viewer > no_access` 继承链
- 编辑文件与内容块：`owner/editor/lecturer`（lecturer 可编辑文件但不能管理文件夹结构，与 Web 一致）
- 草稿文件对 `viewer` 不可见
- `image`/`attachment` 块只能引用有权编辑的附件

工具失败返回 `isError: true`，消息带错误前缀：

| 前缀               | 含义                                                   |
| ------------------ | ------------------------------------------------------ |
| `[UNAUTHORIZED]`   | 缺少/无效令牌                                          |
| `[FORBIDDEN]`      | 无权限（含具体原因，如 `No permission to view draft`） |
| `[NOT_FOUND]`      | 文件/块不存在（不泄漏文档是否存在）                    |
| `[BAD_REQUEST]`    | 参数或块内容校验失败                                   |
| `[INTERNAL_ERROR]` | 服务端异常                                             |

## Vercel 注意事项

- 无状态会话：每次请求独立处理，不依赖内存 session。冷启动后客户端会自动重新 `initialize`，无感。
- `GET /mcp` 的 SSE 流在函数时限（约 120 秒）后会被平台切断；v1 无服务端主动通知，客户端只损失通知通道，工具调用走 POST 不受影响。
- 请求体上限 10 MB（与自托管一致）。

## 运维与安全

- 令牌泄露：立即 `DELETE /admin/api-tokens/<id>` 撤销；撤销后旧的 `lbt_` 令牌即时失效。
- `lastUsedAt` 记录最近使用时间（5 分钟节流），可用于发现异常使用。
- 建议定期轮换：为每个客户端建独立令牌，按需重建并撤销旧的。
- `MCP_ENABLED=false` 可临时关闭整个端点。
- stdio 模式不校验 PAT，`MCP_STDIO_USER_ID` 决定操作者身份，切勿在不可信环境运行。
