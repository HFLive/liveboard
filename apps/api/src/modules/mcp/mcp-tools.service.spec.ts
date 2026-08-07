import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { ConfigService } from "@nestjs/config";
import sharp from "sharp";
import type { AssetsService } from "../files/assets.service";
import type { FilesService } from "../files/files.service";
import { McpToolsService } from "./mcp-tools.service";

/**
 * 通过 SDK 的 InMemoryTransport 走真实协议（initialize → tools/list →
 * tools/call）验证工具注册与行为，authInfo 模拟 PAT 身份注入。
 */
describe("McpToolsService", () => {
  const files = {
    getFolderTree: jest.fn(),
    listFiles: jest.fn(),
    getFile: jest.fn(),
    listBlocks: jest.fn(),
    createFile: jest.fn(),
    updateFile: jest.fn(),
    publishFile: jest.fn(),
    deleteFile: jest.fn(),
    createBlock: jest.fn(),
    updateBlock: jest.fn(),
    deleteBlock: jest.fn(),
    reorderBlocks: jest.fn(),
    // AssetsService 方法（同一 mock 对象兼作两个构造参数）
    uploadAsset: jest.fn(),
    signAssetUpload: jest.fn(),
    confirmAssetUploadCompressed: jest.fn(),
    abortAssetUpload: jest.fn(),
  };
  const config = { get: jest.fn() };

  /** authProvider：extra.authInfo?.userId 透传，模拟 HTTP transport 行为。 */
  const getUserId = (extra: unknown) =>
    (extra as { authInfo?: { userId?: string } } | undefined)?.authInfo
      ?.userId ?? null;

  let clientTransport: InMemoryTransport;
  let serverTransport: InMemoryTransport;
  let pending: Map<number, (message: Record<string, unknown>) => void>;
  let nextId: number;

  beforeEach(() => {
    jest.resetAllMocks();
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    pending = new Map();
    nextId = 0;
    clientTransport.onmessage = (message) => {
      // 只关心 JSON-RPC 响应（带 id）；服务端通知（无 id）直接忽略
      if ("id" in message && typeof message.id === "number") {
        const handler = pending.get(message.id);
        if (handler) {
          pending.delete(message.id);
          handler(message as Record<string, unknown>);
        }
      }
    };
  });

  /** 最小 MCP 客户端：初始化握手 + 发 JSON-RPC 请求。 */
  async function rpc(
    method: string,
    params: Record<string, unknown>,
    authInfo?: { userId: string },
  ): Promise<Record<string, unknown>> {
    const id = ++nextId;
    const promise = new Promise<Record<string, unknown>>((resolve) =>
      pending.set(id, resolve),
    );
    await clientTransport.send(
      { jsonrpc: "2.0", id, method, params },
      { authInfo: authInfo as unknown as AuthInfo },
    );
    return promise;
  }

  async function connect(deploymentTarget = "self_hosted") {
    config.get.mockImplementation((key: string) =>
      key === "DEPLOYMENT_TARGET" ? deploymentTarget : undefined,
    );
    const server = new McpToolsService(
      files as unknown as FilesService,
      files as unknown as AssetsService,
      config as unknown as ConfigService,
    ).createServer(getUserId);
    await server.connect(serverTransport);
    await rpc("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "spec", version: "0.0.0" },
    });
    return server;
  }

  it("registers all 16 document tools", async () => {
    await connect();
    const result = await rpc("tools/list", {});

    const tools = (result.result as { tools: { name: string }[] }).tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "list_folder_tree",
        "list_files",
        "get_file",
        "list_blocks",
        "create_file",
        "update_file",
        "publish_file",
        "delete_file",
        "create_block",
        "update_block",
        "delete_block",
        "reorder_blocks",
        "upload_asset",
        "upload_asset_abort",
        "upload_asset_confirm",
        "upload_asset_url",
      ].sort(),
    );
  });

  it("rejects tool calls without a user identity", async () => {
    await connect();
    files.getFile.mockResolvedValue({ id: "file-1" });

    const result = await rpc(
      "tools/call",
      { name: "get_file", arguments: { fileId: "file-1" } },
      undefined, // 无 authInfo
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "[UNAUTHORIZED] 缺少有效的 API Token" }],
    });
    expect(files.getFile).not.toHaveBeenCalled();
  });

  it("maps permission errors to FORBIDDEN with the service message", async () => {
    await connect();
    files.getFile.mockRejectedValue(
      new ForbiddenException("No permission to view draft"),
    );

    const result = await rpc(
      "tools/call",
      { name: "get_file", arguments: { fileId: "file-1" } },
      { userId: "viewer-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[FORBIDDEN] No permission to view draft",
        },
      ],
    });
  });

  it("maps not-found and validation errors to their prefixes", async () => {
    await connect();
    files.getFile.mockRejectedValue(new NotFoundException("File not found"));
    files.createBlock.mockRejectedValue(
      new BadRequestException("请输入有效的 B站视频链接或嵌入代码"),
    );

    const notFound = await rpc(
      "tools/call",
      { name: "get_file", arguments: { fileId: "missing" } },
      { userId: "user-1" },
    );
    const invalid = await rpc(
      "tools/call",
      {
        name: "create_block",
        arguments: {
          fileId: "file-1",
          type: "bilibili",
          dataJson: { embedCode: "garbage" },
        },
      },
      { userId: "user-1" },
    );

    expect(notFound.result).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "[NOT_FOUND] File not found" }],
    });
    expect(invalid.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[BAD_REQUEST] 请输入有效的 B站视频链接或嵌入代码",
        },
      ],
    });
  });

  it("passes lecturer through the same create_block path", async () => {
    await connect();
    files.createBlock.mockResolvedValue({
      id: "block-1",
      type: "paragraph",
      dataJson: { text: "hi" },
    });

    const result = await rpc(
      "tools/call",
      {
        name: "create_block",
        arguments: {
          fileId: "file-1",
          type: "paragraph",
          dataJson: { text: "hi" },
        },
      },
      { userId: "lecturer-1" },
    );

    expect(result.result).not.toHaveProperty("isError", true);
    expect(files.createBlock).toHaveBeenCalledWith("lecturer-1", "file-1", {
      type: "paragraph",
      dataJson: { text: "hi" },
      afterBlockId: undefined,
    });
  });

  it("maps args for create_file and reorder_blocks", async () => {
    await connect();
    files.createFile.mockResolvedValue({ id: "file-1" });
    files.reorderBlocks.mockResolvedValue([{ id: "b2" }, { id: "b1" }]);

    await rpc(
      "tools/call",
      {
        name: "create_file",
        arguments: { folderId: "folder-1", title: "教案", type: "lesson" },
      },
      { userId: "user-1" },
    );
    await rpc(
      "tools/call",
      {
        name: "reorder_blocks",
        arguments: { fileId: "file-1", blockIds: ["b2", "b1"] },
      },
      { userId: "user-1" },
    );

    expect(files.createFile).toHaveBeenCalledWith("user-1", {
      folderId: "folder-1",
      title: "教案",
      type: "lesson",
    });
    expect(files.reorderBlocks).toHaveBeenCalledWith("user-1", "file-1", {
      blockIds: ["b2", "b1"],
    });
  });

  it("decodes base64 and relays non-image files unchanged", async () => {
    await connect();
    files.uploadAsset.mockResolvedValue({
      id: "asset-1",
      url: "/assets/asset-1",
    });

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          fileId: "file-1",
          filename: "a.txt",
          mimeType: "text/plain",
          data: Buffer.from("hello").toString("base64"),
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).not.toHaveProperty("isError", true);
    expect(files.uploadAsset).toHaveBeenCalledWith(
      "user-1",
      { fileId: "file-1", folderId: undefined },
      {
        originalname: "a.txt",
        mimetype: "text/plain",
        size: 5,
        buffer: Buffer.from("hello"),
      },
    );
  });

  it("accepts data: URL prefixes and compresses images to WebP", async () => {
    await connect();
    files.uploadAsset.mockResolvedValue({
      id: "asset-1",
      url: "/assets/asset-1",
    });
    const png = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 120, g: 60, b: 30 },
      },
    })
      .png()
      .toBuffer();

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          fileId: "file-1",
          filename: "photo.png",
          mimeType: "image/png",
          data: `data:image/png;base64,${png.toString("base64")}`,
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).not.toHaveProperty("isError", true);
    expect(files.uploadAsset).toHaveBeenCalledTimes(1);
    const [, , file] = files.uploadAsset.mock.calls[0] as unknown as [
      string,
      { fileId: string; folderId?: string },
      { originalname: string; mimetype: string; size: number; buffer: Buffer },
    ];
    expect(file.originalname).toBe("photo.webp");
    expect(file.mimetype).toBe("image/webp");
    expect(file.size).toBe(file.buffer.length);
    expect(file.buffer.length).toBeLessThan(png.length);
  });

  it("rejects invalid base64 without calling the service", async () => {
    await connect();

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          fileId: "file-1",
          filename: "a.png",
          data: "!!not-base64!!",
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: "[BAD_REQUEST] 文件内容不是有效的 base64" },
      ],
    });
    expect(files.uploadAsset).not.toHaveBeenCalled();
  });

  it("requires fileId or folderId for upload_asset", async () => {
    await connect();

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          filename: "a.png",
          data: Buffer.from("hi").toString("base64"),
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[BAD_REQUEST] fileId 与 folderId 至少提供一项（fileId=内嵌到文档，folderId=独立附件）",
        },
      ],
    });
    expect(files.uploadAsset).not.toHaveBeenCalled();
  });

  it("rejects upload_asset above the 7MB base64 cap", async () => {
    await connect();

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          fileId: "file-1",
          filename: "big.bin",
          data: Buffer.alloc(7 * 1024 * 1024 + 1, 0x61).toString("base64"),
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        { type: "text", text: "[BAD_REQUEST] 文件超过 MCP 上传上限（7MB）" },
      ],
    });
    expect(files.uploadAsset).not.toHaveBeenCalled();
  });

  it("redirects upload_asset to the direct flow on Vercel", async () => {
    await connect("vercel");

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset",
        arguments: {
          fileId: "file-1",
          filename: "a.png",
          data: Buffer.from("hi").toString("base64"),
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[ERROR] 当前部署（Vercel）不支持 base64 中转上传，请改用 upload_asset_url → HTTP PUT → upload_asset_confirm",
        },
      ],
    });
    expect(files.uploadAsset).not.toHaveBeenCalled();
  });

  it("redirects upload_asset_url to base64 relay on self-hosted", async () => {
    await connect();

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset_url",
        arguments: {
          fileId: "file-1",
          filename: "a.png",
          sizeBytes: 100,
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[ERROR] 当前部署（自托管）请使用 upload_asset（base64 中转上传）",
        },
      ],
    });
    expect(files.signAssetUpload).not.toHaveBeenCalled();
  });

  it("signs direct uploads on Vercel with a 300s presign TTL", async () => {
    await connect("vercel");
    files.signAssetUpload.mockResolvedValue({
      uploadId: "upload-1",
      instruction: {
        transport: "put",
        url: "https://r2.example/obj",
        headers: [],
      },
      expiresAt: "2026-08-08T00:00:00Z",
    });

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset_url",
        arguments: {
          fileId: "file-1",
          filename: "a.png",
          sizeBytes: 100,
          mimeType: "image/png",
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).not.toHaveProperty("isError", true);
    expect(files.signAssetUpload).toHaveBeenCalledWith(
      "user-1",
      {
        folderId: undefined,
        fileId: "file-1",
        filename: "a.png",
        sizeBytes: 100,
        mimeType: "image/png",
      },
      { expirySeconds: 300 },
    );
  });

  it("rejects direct uploads above the 8MB single-PUT cap", async () => {
    await connect("vercel");

    const result = await rpc(
      "tools/call",
      {
        name: "upload_asset_url",
        arguments: {
          fileId: "file-1",
          filename: "big.png",
          sizeBytes: 9 * 1024 * 1024,
        },
      },
      { userId: "user-1" },
    );

    expect(result.result).toMatchObject({
      isError: true,
      content: [
        {
          type: "text",
          text: "[BAD_REQUEST] MCP 直传仅支持单请求 PUT，文件不能超过 8MB，请压缩后重试或改用 Web 端上传",
        },
      ],
    });
    expect(files.signAssetUpload).not.toHaveBeenCalled();
  });

  it("confirms and aborts direct uploads", async () => {
    await connect("vercel");
    files.confirmAssetUploadCompressed.mockResolvedValue({
      id: "asset-1",
      url: "/assets/asset-1",
    });
    files.abortAssetUpload.mockResolvedValue({ ok: true });

    const confirmed = await rpc(
      "tools/call",
      { name: "upload_asset_confirm", arguments: { uploadId: "upload-1" } },
      { userId: "user-1" },
    );
    const aborted = await rpc(
      "tools/call",
      { name: "upload_asset_abort", arguments: { uploadId: "upload-1" } },
      { userId: "user-1" },
    );

    expect(confirmed.result).not.toHaveProperty("isError", true);
    expect(files.confirmAssetUploadCompressed).toHaveBeenCalledWith(
      "user-1",
      "upload-1",
    );
    expect(aborted.result).not.toHaveProperty("isError", true);
    expect(files.abortAssetUpload).toHaveBeenCalledWith("user-1", "upload-1");
  });
});
