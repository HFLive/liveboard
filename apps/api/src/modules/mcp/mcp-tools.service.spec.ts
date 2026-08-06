import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
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
  };

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

  async function connect() {
    const server = new McpToolsService(
      files as unknown as FilesService,
    ).createServer(getUserId);
    await server.connect(serverTransport);
    await rpc("initialize", {
      protocolVersion: LATEST_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "spec", version: "0.0.0" },
    });
    return server;
  }

  it("registers all 12 document tools", async () => {
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
});
