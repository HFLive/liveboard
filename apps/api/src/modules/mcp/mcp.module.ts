import { Module } from "@nestjs/common";
import { ApiTokensModule } from "../api-tokens/api-tokens.module";
import { FilesModule } from "../files/files.module";
import { McpController } from "./mcp.controller";
import { McpServerService } from "./mcp-server.service";
import { McpToolsService } from "./mcp-tools.service";

@Module({
  imports: [ApiTokensModule, FilesModule],
  controllers: [McpController],
  providers: [McpServerService, McpToolsService],
})
export class McpModule {}
