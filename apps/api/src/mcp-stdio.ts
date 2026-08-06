import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { McpServerService } from "./modules/mcp/mcp-server.service";

/**
 * MCP stdio 入口：本地 Claude Desktop / Claude Code 直连（不监听 HTTP）。
 * 操作者身份由 MCP_STDIO_USER_ID 环境变量指定（stdio 本地进程即信任边界，
 * 不校验 PAT）；未配置时全部工具返回 [UNAUTHORIZED]（fail-closed）。
 *
 * 注意：必须运行编译产物（tsx 不发射装饰器元数据，Nest DI 会失效）：
 *   pnpm --filter @liveboard/api mcp:stdio   （内部先 build 再 node dist）
 *   生产：MCP_STDIO_USER_ID=<userId> node dist/mcp-stdio.js
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    // stdout 是 MCP 协议通道，所有日志一律走 stderr；Nest 默认 logger 写
    // stdout 会污染协议流，这里显式替换。启动失败时 Nest 的 exceptions-zone
    // 会 process.exit(1)（错误同样经此 logger 输出到 stderr）。
    logger: {
      log: (message) => process.stderr.write(`${String(message)}\n`),
      error: (message) => process.stderr.write(`${String(message)}\n`),
      warn: (message) => process.stderr.write(`${String(message)}\n`),
      debug: () => {},
      verbose: () => {},
    },
  });
  const mcp = app.get(McpServerService);
  const server = mcp.createServer();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    StdioServerTransport,
  } = require("@modelcontextprotocol/sdk/server/stdio.js");
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const shutdown = async () => {
    await server.close().catch(() => {});
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((error) => {
  console.error(
    "MCP stdio server failed to start:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
