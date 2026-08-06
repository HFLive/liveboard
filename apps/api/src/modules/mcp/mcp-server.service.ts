import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpToolsService, type AuthProvider } from "./mcp-tools.service";

/**
 * MCP 无状态 HTTP 服务：
 * - 每请求新建 transport 与 McpServer（SDK 的 Protocol.connect 不允许同一
 *   实例并发连接两个 transport；无状态 transport 也禁止跨请求复用）
 * - sessionIdGenerator 缺省 = 无状态模式：不生成/不校验会话 ID，
 *   天然兼容 Vercel 冷启动（客户端自动重新 initialize）
 * - v1 无服务端主动通知，GET SSE 通道断开无影响
 */
@Injectable()
export class McpServerService {
  private readonly enabled: boolean;

  constructor(
    private readonly tools: McpToolsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>("MCP_ENABLED", "true") !== "false";
  }

  /** HTTP 模式：extra.authInfo 来自 ApiTokenGuard 写入的 req.auth。 */
  private readonly getUserId: AuthProvider = (extra) => {
    const auth = (
      extra as { authInfo?: { userId?: string } | null } | undefined
    )?.authInfo;
    return auth?.userId ?? process.env.MCP_STDIO_USER_ID ?? null;
  };

  async handleRequest(
    req: Request,
    res: Response,
    parsedBody?: unknown,
  ): Promise<void> {
    if (!this.enabled) {
      res.status(404).json({ error: "MCP disabled" });
      return;
    }

    // 动态 require：MCP SDK 的深层依赖（@hono/node-server）在 Vercel 的
    // @vercel/nft 文件追踪中可能被遗漏（SDK 使用 ./ 通配符 exports）。
    // 放在方法内延迟加载，失败时只影响 /mcp 端点，其余 API 正常。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      StreamableHTTPServerTransport: Transport,
    } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");

    const server = this.tools.createServer(this.getUserId);
    const transport = new Transport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    const close = () => {
      void transport.close().catch(() => {});
      void server.close().catch(() => {});
    };
    // 请求完成或客户端断开（含 GET SSE 被平台切断）时收尾
    res.on("close", close);

    try {
      await server.connect(transport);
      await transport.handleRequest(req as never, res as never, parsedBody);
    } catch {
      if (!res.headersSent) {
        res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Invalid MCP request" },
          id: null,
        });
      }
    }
  }

  /** stdio 入口用：创建连接了 StdioServerTransport 的 server 实例。 */
  createServer(): McpServer {
    return this.tools.createServer(this.getUserId);
  }
}
