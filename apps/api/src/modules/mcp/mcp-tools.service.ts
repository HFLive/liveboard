import {
  BadRequestException,
  HttpException,
  Injectable,
  NotImplementedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getDeploymentTarget } from "../../common/deployment-target";
import { AssetsService } from "../files/assets.service";
import { FilesService } from "../files/files.service";
import { compressImageBuffer } from "../files/image-compress";

/**
 * MCP 中转上传（base64）的二进制大小上限。自托管 express.json limit 10mb
 * （main.ts），base64 膨胀 4/3 后留出 JSON 信封余量；Vercel 平台请求体限制
 * 约 4.5MB，但 Vercel 下该工具被门控停用（走 upload_asset_url 直传）。
 */
const MCP_BASE64_MAX_BYTES = 7 * 1024 * 1024;
/** 7MB 二进制对应的 base64 文本长度（4/3 膨胀）+ 256 字符余量，不做解码快速拒绝。 */
const MCP_BASE64_MAX_CHARS = Math.ceil((MCP_BASE64_MAX_BYTES / 3) * 4) + 256;
/** MCP 直传（Vercel）单请求 PUT 上限：>8MiB 需 multipart，LLM 客户端不可靠，明确拒绝。 */
const MCP_DIRECT_MAX_BYTES = 8 * 1024 * 1024;
/** MCP 直传预签名 URL 有效期：LLM 跨工具调用延迟不可控，放宽到 5 分钟。 */
const MCP_PRESIGN_TTL_SECONDS = 300;

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
- image / attachment：{"assetId": "...", "url": "/assets/<id>", "text": "<文件名>", "filename": "<文件名>", "mimeType": "...", "sizeBytes": N}（assetId 与 url 来自 upload_asset / upload_asset_confirm 返回值；url 缺失时前端渲染"等待上传"占位）
- bilibili：{"embedCode": "..."}（B站嵌入代码或链接，≤5000 字符）
- math：{"text": "..."}（LaTeX，≤50000 字符）
- table：{"rows": [["单元格", ...], ...]}（1-50 行，每行 1-20 列）
- question：编辑器富结构对象（透传）`;

/** 剥离 `data:<mediatype>;base64,` 前缀；非 data: URL 原样返回。 */
function stripDataUrlPrefix(data: string): string {
  if (!data.startsWith("data:")) return data;
  const comma = data.indexOf(",");
  const meta = comma === -1 ? "" : data.slice(5, comma);
  if (comma === -1 || !/;base64$/i.test(meta)) {
    throw new BadRequestException("文件内容不是有效的 base64");
  }
  return data.slice(comma + 1);
}

/**
 * 严格 base64 解码。Node 的 Buffer.from(s, "base64") 对非法字符静默跳过、
 * 不抛错，因此需要 字符集正则 + padding 归一 + round-trip 三重校验。
 * 同时兼容 base64url（`-`/`_` 与无 padding）与 shell base64 输出的换行。
 */
function decodeBase64Strict(encoded: string): Buffer {
  const compact = encoded
    .replace(/\s+/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  if (compact.length === 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)) {
    throw new BadRequestException("文件内容不是有效的 base64");
  }
  const eq = compact.indexOf("=");
  if (eq !== -1 && compact.length % 4 !== 0) {
    // "=" 只能出现在 4 的倍数长度结尾
    throw new BadRequestException("文件内容不是有效的 base64");
  }
  const padded =
    compact.length % 4 === 0
      ? compact
      : compact + "=".repeat(4 - (compact.length % 4));
  const buf = Buffer.from(padded, "base64");
  if (buf.toString("base64") !== padded) {
    // 解码再编码回不到原文 => 含有被 Buffer.from 静默跳过的非法字符
    throw new BadRequestException("文件内容不是有效的 base64");
  }
  return buf;
}

@Injectable()
export class McpToolsService {
  constructor(
    private readonly files: FilesService,
    private readonly assets: AssetsService,
    private readonly config: ConfigService,
  ) {}

  /**
   * 构建注册好全部工具的 MCP server。每次 HTTP 请求都应新建实例
   * （SDK 的 Protocol.connect 不允许同一实例并发连接两个 transport）。
   */
  createServer(getUserId: AuthProvider): McpServer {
    // 动态 require：与 mcp-server.service.ts 同理，避免顶层静态 import 在
    // Vercel 上因依赖追踪遗漏导致整个 API 进程 crash。
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const server: McpServer =
      new (require("@modelcontextprotocol/sdk/server/mcp.js").McpServer)({
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

    server.registerTool(
      "upload_asset",
      {
        title: "上传附件（base64 中转）",
        description:
          "以 base64 将图片或附件上传到工作区（服务器中转），图片自动压缩为 WebP（最长边 1600px、质量 0.82，与 Web 端一致）。" +
          `仅自托管部署可用，文件二进制上限 ${MCP_BASE64_MAX_BYTES / 1024 / 1024}MB，data 为 base64 文件内容（可带 data: URL 前缀）。` +
          "fileId 与 folderId 至少提供一项：fileId=内嵌到文档（需该文档编辑权限）；folderId=独立附件（需该文件夹编辑权限）。" +
          "返回 asset 对象（含 id、url=/assets/<id>、filename、mimeType、sizeBytes），请用 create_block 建 image/attachment 块，" +
          "dataJson 结构见下方说明。" +
          DATA_JSON_GUIDE,
        inputSchema: {
          fileId: z.string().optional(),
          folderId: z.string().optional(),
          filename: z.string().min(1),
          mimeType: z.string().optional(),
          data: z.string().min(1),
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () => this.uploadAssetTool(userId, args));
      },
    );

    server.registerTool(
      "upload_asset_url",
      {
        title: "获取直传上传地址",
        description:
          "Vercel 部署专用：为文件获取预签名 PUT 直传地址（绕过 API 请求体限制，上限 " +
          `${MCP_DIRECT_MAX_BYTES / 1024 / 1024}MB）。流程：1) 调本工具拿到 {uploadId, instruction, expiresAt}；` +
          "2) 用 HTTP PUT 把文件字节传到 instruction.url（需带 instruction.headers，如 " +
          'curl -X PUT -H "Content-Type: <mimeType>" --data-binary @<本地文件> "<url>"），必须在 expiresAt 前完成；' +
          "3) 再调 upload_asset_confirm（参数 uploadId）完成上传，图片会自动压缩为 WebP。" +
          "fileId 与 folderId 至少提供一项：fileId=内嵌到文档（需该文档编辑权限）；folderId=独立附件（需该文件夹编辑权限）。",
        inputSchema: {
          fileId: z.string().optional(),
          folderId: z.string().optional(),
          filename: z.string().min(1),
          sizeBytes: z.number().int().positive(),
          mimeType: z.string().optional(),
        },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () => this.signAssetUploadTool(userId, args));
      },
    );

    server.registerTool(
      "upload_asset_confirm",
      {
        title: "确认直传上传",
        description:
          "Vercel 部署专用：确认 upload_asset_url 获取地址后已直传完成的文件。图片会由服务端自动压缩为 WebP（最长边 1600px、质量 0.82，与 Web 端一致）。" +
          "返回 asset 对象（含 id、url=/assets/<id>、filename、mimeType、sizeBytes），请用 create_block 建 image/attachment 块，" +
          "dataJson 结构见下方说明。" +
          DATA_JSON_GUIDE,
        inputSchema: { uploadId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.assets.confirmAssetUploadCompressed(userId, args.uploadId),
        );
      },
    );

    server.registerTool(
      "upload_asset_abort",
      {
        title: "取消直传上传",
        description:
          "取消 upload_asset_url 发起的上传：释放预留并清理已上传的临时对象。重复调用安全；放弃上传后建议调用以释放配额。",
        inputSchema: { uploadId: z.string() },
      },
      (args, extra) => {
        const userId = op(extra);
        return this.run(userId, () =>
          this.assets.abortAssetUpload(userId, args.uploadId),
        );
      },
    );

    return server;
  }

  /** upload_asset：部署门控 + base64 解码 + 服务端压缩 + 中转上传。 */
  private async uploadAssetTool(
    userId: string | null,
    args: {
      fileId?: string;
      folderId?: string;
      filename: string;
      mimeType?: string;
      data: string;
    },
  ) {
    if (getDeploymentTarget(this.config) === "vercel") {
      throw new NotImplementedException(
        "当前部署（Vercel）不支持 base64 中转上传，请改用 upload_asset_url → HTTP PUT → upload_asset_confirm",
      );
    }
    if (!args.fileId && !args.folderId) {
      throw new BadRequestException(
        "fileId 与 folderId 至少提供一项（fileId=内嵌到文档，folderId=独立附件）",
      );
    }
    const payload = stripDataUrlPrefix(args.data);
    if (payload.length > MCP_BASE64_MAX_CHARS) {
      throw new BadRequestException(
        `文件超过 MCP 上传上限（${MCP_BASE64_MAX_BYTES / 1024 / 1024}MB）`,
      );
    }
    const buffer = decodeBase64Strict(payload);
    if (buffer.length > MCP_BASE64_MAX_BYTES) {
      throw new BadRequestException(
        `文件超过 MCP 上传上限（${MCP_BASE64_MAX_BYTES / 1024 / 1024}MB）`,
      );
    }
    const compressed = await compressImageBuffer(
      buffer,
      args.mimeType ?? "application/octet-stream",
      args.filename,
    );
    return this.assets.uploadAsset(
      userId,
      { fileId: args.fileId, folderId: args.folderId },
      compressed
        ? {
            originalname: compressed.filename,
            mimetype: compressed.mimeType,
            size: compressed.buffer.length,
            buffer: compressed.buffer,
          }
        : {
            originalname: args.filename,
            mimetype: args.mimeType ?? "application/octet-stream",
            size: buffer.length,
            buffer,
          },
    );
  }

  /** upload_asset_url：部署门控 + 单请求 PUT 上限校验 + 长 TTL 签名。 */
  private async signAssetUploadTool(
    userId: string | null,
    args: {
      fileId?: string;
      folderId?: string;
      filename: string;
      sizeBytes: number;
      mimeType?: string;
    },
  ) {
    if (getDeploymentTarget(this.config) !== "vercel") {
      throw new NotImplementedException(
        "当前部署（自托管）请使用 upload_asset（base64 中转上传）",
      );
    }
    if (!args.fileId && !args.folderId) {
      throw new BadRequestException(
        "fileId 与 folderId 至少提供一项（fileId=内嵌到文档，folderId=独立附件）",
      );
    }
    if (args.sizeBytes > MCP_DIRECT_MAX_BYTES) {
      throw new BadRequestException(
        `MCP 直传仅支持单请求 PUT，文件不能超过 ${MCP_DIRECT_MAX_BYTES / 1024 / 1024}MB，请压缩后重试或改用 Web 端上传`,
      );
    }
    return this.assets.signAssetUpload(
      userId,
      {
        folderId: args.folderId,
        fileId: args.fileId,
        filename: args.filename,
        sizeBytes: args.sizeBytes,
        mimeType: args.mimeType,
      },
      { expirySeconds: MCP_PRESIGN_TTL_SECONDS },
    );
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
