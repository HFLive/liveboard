import type { Request, Response } from "express";
import { IS_PUBLIC_KEY } from "../../common/public.decorator";
import { ApiTokenGuard } from "../api-tokens/api-token.guard";
import { McpController } from "./mcp.controller";
import { McpServerService } from "./mcp-server.service";

describe("McpController", () => {
  const mcp = { handleRequest: jest.fn() };
  let controller: McpController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new McpController(mcp as unknown as McpServerService);
  });

  it("is wired to the PAT guard and public cookie exemption", () => {
    const guards = Reflect.getMetadata("__guards__", McpController) ?? [];
    const isPublic = Reflect.getMetadata(IS_PUBLIC_KEY, McpController) ?? false;
    expect(guards).toContain(ApiTokenGuard);
    expect(isPublic).toBe(true);
  });

  it("delegates POST to handleRequest with the parsed body", async () => {
    const req = { body: { jsonrpc: "2.0" } } as Request;
    const res = {} as Response;
    mcp.handleRequest.mockResolvedValue(undefined);

    await controller.mcpPost(req, res);

    expect(mcp.handleRequest).toHaveBeenCalledWith(req, res, {
      jsonrpc: "2.0",
    });
  });

  it("delegates GET without a parsed body", async () => {
    const req = {} as Request;
    const res = {} as Response;
    mcp.handleRequest.mockResolvedValue(undefined);

    await controller.mcpSse(req, res);

    expect(mcp.handleRequest).toHaveBeenCalledWith(req, res);
  });
});
