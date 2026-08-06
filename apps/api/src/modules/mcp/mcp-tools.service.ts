import { HttpException, Injectable } from "@nestjs/common";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { FilesService } from "../files/files.service";

/**
 * 工具操作者身份解析：HTTP 模式从 transport 透传的 extra.authInfo
 * （由 ApiTokenGuard 设的 req.auth 而来）取 userId；stdio 模式无 transport
 * auth，回退 MCP_STDIO_USER_ID 环境变量。解析失败返回 null（fail-closed）。
 */
export type AuthProvider = (extra: unknown) => string | null;

const BLOCK_TYPES = [
  "heading_1",
  "heading_2",
  "heading_3",
  "heading_4",
  "heading_5",
  "heading_6",
  "paragraph",
  "bulleted_list",
  "numbered_list",
  "todo",
  "code",
  "quote",
  "image",
  "attachment",
  "bilibili",
  "divider",
  "question",
  "table",
  "math",
] as const;

const FILE_TYPES = [
  "book",
  "lesson",
  "course",
  "exercise_set",
  "doc",
  "asset",
] as const;

const blockTypeSchema = z.enum(BLOCK_TYPES);
const fileTypeSchema = z.enum(FILE_TYPES).optional();
// dataJson 结构校验（bilibili/math/table 等）复用 FilesService.assertValidStructuredBlock，
// 这里只做透传。
const dataJsonSchema = z.record(z.string(), z.unknown());

/** 各类型内容块的 dataJson 结构，写入工具描述帮助模型生成正确载荷。 */
const DATA_JSON_GUIDE = `各块类型的 dataJson 结构：
- heading_1..6 / paragraph / bulleted_list / numbered_list / todo / code / quote：{"text": "..."}
- divider：{}
- image / attachment：{"assetId": "..."}（引用工作区内已上传的附件）
- bilibili：{"embedCode": "..."}（B站嵌入代码或链接，≤5000 字符）
- math：{"text": "..."}（LaTeX，≤50000 字符）
- table：{"rows": [["单元格", ...], ...]}（1-50 行，每行 1-20 列）
- question：编辑器富结构对象（透传）`;

@Injectable()
export class McpToolsService {
  constructor(private readonly files: FilesService) {}

  /**
   * 构建注册好全部工具的 MCP server。每次 HTTP 请求都应新建实例
   * （SDK 的 Protocol.connect 不允许同一实例并发连接两个 transport）。
   */
  createServer(getUserId: AuthProvider): McpServer {
    // 动态 require：与 mcp-server.service.ts 同理，避免顶层静态 import 在
    // Vercel 上因依赖追踪遗漏导致整个 API 进程 crash。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const server: McpServer = new (
      require("@modelcontextprotocol/sdk/server/mcp.js").McpServer
    )({
      name: "liveboard-docs",
      version: "1.0.0",
    });

    const op = (extra: unknown) => {
      const userId = getUserId(extra);
      return userId;
    };

    server.registerTool(
      "list_folder_tree",
      {
        title: "列出文件夹树",
        description:
          "列出当前用户可查看的文件夹树（含各文件夹权限等级与文件数）。草稿文件对 viewer 不可见。",
        inputSchema: {},
      },
      (_, extra) => {
        const userId = op(extra);
        return this.run(userId, () => this.files.getFolderTree(userId));
      },
    );

    server.registerTool(
      "list_files",
      {
        title: "列出文件夹内文件",
        description:
          "列出指定文件夹（或全部）当前用户可查看的文件与独立附件。草稿文件对 viewer 不可见。",
        inputSchema: { folderId: z.string().optional() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.listFiles(userId, { folderId: args.folderId }),
        );
      },
    );

    server.registerTool(
      "get_file",
      {
        title: "获取文件详情",
        description:
          "获取单个文件的详情（标题、类型、状态、版本、权限等级等）。不存在的文件统一返回 File not found。",
        inputSchema: { fileId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () => this.files.getFile(userId, args.fileId));
      },
    );

    server.registerTool(
      "list_blocks",
      {
        title: "列出内容块",
        description:
          "列出文件的内容块（按顺序排列），每块含 type 与 dataJson。" +
          DATA_JSON_GUIDE,
        inputSchema: { fileId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.listBlocks(userId, args.fileId),
        );
      },
    );

    server.registerTool(
      "create_file",
      {
        title: "创建文件",
        description:
          "在指定文件夹下创建文件。需要对该文件夹有编辑权限（owner/editor）或 lecturer 权限。type 可选：doc/lesson/book/course/exercise_set，默认 doc。",
        inputSchema: {
          folderId: z.string(),
          title: z.string().min(1),
          type: fileTypeSchema,
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.createFile(userId, {
            folderId: args.folderId,
            title: args.title,
            type: args.type,
          }),
        );
      },
    );

    server.registerTool(
      "update_file",
      {
        title: "更新文件",
        description:
          "修改文件标题或移动到其他文件夹。title 与 folderId 至少提供一项。",
        inputSchema: {
          fileId: z.string(),
          title: z.string().min(1).optional(),
          folderId: z.string().optional(),
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.updateFile(userId, args.fileId, {
            title: args.title,
            folderId: args.folderId,
          }),
        );
      },
    );

    server.registerTool(
      "publish_file",
      {
        title: "发布文件",
        description: "发布文件（draft → published）。发布后 viewer 即可查看。",
        inputSchema: { fileId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.publishFile(userId, args.fileId),
        );
      },
    );

    server.registerTool(
      "delete_file",
      {
        title: "删除文件",
        description:
          "删除文件及其全部内容块（不可恢复，附件引用会被清理）。危险操作：执行前必须向用户确认。",
        inputSchema: { fileId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.deleteFile(userId, args.fileId),
        );
      },
    );

    server.registerTool(
      "create_block",
      {
        title: "创建内容块",
        description:
          "在文件末尾（或 afterBlockId 指定的块之后）创建内容块。需要对该文件有编辑权限（owner/editor）或 lecturer 权限。" +
          DATA_JSON_GUIDE,
        inputSchema: {
          fileId: z.string(),
          type: blockTypeSchema,
          dataJson: dataJsonSchema,
          afterBlockId: z.string().optional(),
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.createBlock(userId, args.fileId, {
            type: args.type,
            dataJson: args.dataJson,
            afterBlockId: args.afterBlockId,
          }),
        );
      },
    );

    server.registerTool(
      "update_block",
      {
        title: "更新内容块",
        description:
          "更新内容块的 dataJson（可同时改 type）。" + DATA_JSON_GUIDE,
        inputSchema: {
          blockId: z.string(),
          type: blockTypeSchema.optional(),
          dataJson: dataJsonSchema,
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.updateBlock(userId, args.blockId, {
            type: args.type,
            dataJson: args.dataJson,
          }),
        );
      },
    );

    server.registerTool(
      "delete_block",
      {
        title: "删除内容块",
        description: "删除单个内容块（不可恢复）。",
        inputSchema: { blockId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.deleteBlock(userId, args.blockId),
        );
      },
    );

    server.registerTool(
      "reorder_blocks",
      {
        title: "重排内容块",
        description:
          "按 blockIds 顺序重排文件全部内容块（blockIds 必须包含该文件所有块的 id）。返回重排后的完整块列表。",
        inputSchema: {
          fileId: z.string(),
          blockIds: z.array(z.string()).min(1),
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.files.reorderBlocks(userId, args.fileId, {
            blockIds: args.blockIds,
          }),
        );
      },
    );

    return server;
  }

  /** 统一工具执行包装：身份校验 + 错误映射为 LLM 可读的 [PREFIX] 消息。 */
  private run<T>(
    userId: string | null,
    fn: () => Promise<T>,
  ): Promise<CallToolResult> {
    if (!userId) {
      return Promise.resolve(this.error("[UNAUTHORIZED] 缺少有效的 API Token"));
    }
    return fn()
      .then((value) => ({
        content: [
          { type: "text" as const, text: JSON.stringify(value, null, 2) },
        ],
      }))
      .catch((caught) => this.error(toMcpErrorText(caught)));
  }

  private error(text: string): CallToolResult {
    return { content: [{ type: "text", text }], isError: true };
  }
}

function toMcpErrorText(caught: unknown): string {
  if (caught instanceof HttpException) {
    const status = caught.getStatus();
    const code =
      status === 401
        ? "UNAUTHORIZED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : status === 409
              ? "CONFLICT"
              : status === 400
                ? "BAD_REQUEST"
                : "ERROR";
    const message = caught.message;
    const text =
      typeof message === "string" && message.length > 0 ? message : "请求无效";
    return `[${code}] ${text}`;
  }
  const detail = caught instanceof Error ? caught.message : String(caught);
  return `[INTERNAL_ERROR] ${detail}`;
}
