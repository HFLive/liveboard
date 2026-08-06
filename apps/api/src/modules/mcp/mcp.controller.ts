import { Controller, Get, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { Public } from "../../common/public.decorator";
import { ApiTokenGuard } from "../api-tokens/api-token.guard";
import { McpServerService } from "./mcp-server.service";

/**
 * MCP 端点（Streamable HTTP，无状态）：
 * - POST /mcp：JSON-RPC 请求/响应（工具调用等）
 * - GET /mcp：SSE 流（服务端通知通道；v1 无主动通知，Vercel 上被切断无影响）
 * 认证走 PAT（Bearer 头），@Public() 豁免全局 cookie 守卫后由
 * ApiTokenGuard 单独校验，不扩大到全 API。
 */
@Controller()
@Public()
@UseGuards(ApiTokenGuard)
export class McpController {
  constructor(private readonly mcp: McpServerService) {}

  @Post("mcp")
  async mcpPost(@Req() req: Request, @Res() res: Response) {
    // req.body 复用 express 已解析的 body，避免重复读流
    await this.mcp.handleRequest(req, res, req.body);
  }

  @Get("mcp")
  async mcpSse(@Req() req: Request, @Res() res: Response) {
    await this.mcp.handleRequest(req, res);
  }
}
