import type { Response } from "express";
import type { AssetsService } from "./assets.service";
import { FilesController } from "./files.controller";
import type { FilesService } from "./files.service";

describe("FilesController Markdown endpoints", () => {
  const assetsService = {
    getAssetForDownload: jest.fn(),
  };
  const filesService = {
    importMarkdown: jest.fn(),
    exportMarkdown: jest.fn(),
  };
  const response = {
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  let controller: FilesController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new FilesController(
      assetsService as unknown as AssetsService,
      filesService as unknown as FilesService,
    );
  });

  it("allows safe images to render across the local Web and API origins", async () => {
    const stream = { pipe: jest.fn() };
    assetsService.getAssetForDownload.mockResolvedValue({
      asset: { filename: "preview.png", mimeType: "image/png" },
      stream,
    });

    await controller.getAsset(
      "user-1",
      "asset-1",
      response as unknown as Response,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "same-site",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'inline; filename="preview.png"',
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it("keeps download-only attachments restricted to the same origin", async () => {
    const stream = { pipe: jest.fn() };
    assetsService.getAssetForDownload.mockResolvedValue({
      asset: { filename: "notes.pdf", mimeType: "application/pdf" },
      stream,
    });

    await controller.getAsset(
      "user-1",
      "asset-1",
      response as unknown as Response,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "same-origin",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="notes.pdf"',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "sandbox",
    );
  });

  it("forwards the uploaded Markdown buffer and current folder", async () => {
    filesService.importMarkdown.mockResolvedValue({
      file: { id: "file-1" },
      warnings: [],
      blockCount: 1,
    });
    const file = {
      originalname: "课程.md",
      mimetype: "text/markdown",
      size: 8,
      buffer: Buffer.from("# 标题"),
    };

    await controller.importMarkdown("user-1", { folderId: "folder-1" }, file);

    expect(filesService.importMarkdown).toHaveBeenCalledWith("user-1", {
      folderId: "folder-1",
      originalname: "课程.md",
      size: 8,
      buffer: file.buffer,
    });
  });

  it("restores UTF-8 Markdown filenames decoded as Latin-1 by multipart", async () => {
    filesService.importMarkdown.mockResolvedValue({
      file: { id: "file-1" },
      warnings: [],
      blockCount: 1,
    });
    const file = {
      originalname: "ä½ å¥½.md",
      mimetype: "text/markdown",
      size: 8,
      buffer: Buffer.from("# 标题"),
    };

    await controller.importMarkdown("user-1", { folderId: "folder-1" }, file);

    expect(filesService.importMarkdown).toHaveBeenCalledWith("user-1", {
      folderId: "folder-1",
      originalname: "你好.md",
      size: 8,
      buffer: file.buffer,
    });
  });

  it("sets a UTF-8 attachment filename and nosniff on export", async () => {
    filesService.exportMarkdown.mockResolvedValue({
      filename: "第一讲.md",
      content: "# 第一讲\n",
    });

    await controller.exportMarkdown(
      "user-1",
      "file-1",
      response as unknown as Response,
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "text/markdown; charset=utf-8",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      "attachment; filename=\"content.md\"; filename*=UTF-8''%E7%AC%AC%E4%B8%80%E8%AE%B2.md",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "X-Content-Type-Options",
      "nosniff",
    );
    expect(response.send).toHaveBeenCalledWith("# 第一讲\n");
  });
});
