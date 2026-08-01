import type { Response } from "express";
import {
  PRIVATE_IMMUTABLE_CACHE_CONTROL,
  PRIVATE_NO_STORE_CACHE_CONTROL,
} from "../../common/cache-control";
import type { AssetsService } from "./assets.service";
import { FilesController } from "./files.controller";
import type { FilesService } from "./files.service";

describe("FilesController Markdown endpoints", () => {
  const assetsService = {
    getAssetForDownload: jest.fn(),
    getAssetForPreview: jest.fn(),
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
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_IMMUTABLE_CACHE_CONTROL,
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });

  it("forces attachment download for images when download is requested", async () => {
    const stream = { pipe: jest.fn() };
    assetsService.getAssetForDownload.mockResolvedValue({
      asset: { filename: "preview.png", mimeType: "image/png" },
      stream,
    });

    await controller.getAsset(
      "user-1",
      "asset-1",
      response as unknown as Response,
      "1",
    );

    expect(assetsService.getAssetForDownload).toHaveBeenCalledWith(
      "user-1",
      "asset-1",
      true,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/octet-stream",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'attachment; filename="preview.png"',
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "same-origin",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_NO_STORE_CACHE_CONTROL,
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

  it.each([
    ["pdf", "application/pdf", Buffer.from("%PDF-1.7")],
    ["markdown", "text/markdown; charset=utf-8", "# 标题"],
    ["text", "text/plain; charset=utf-8", "正文"],
  ])(
    "returns authenticated %s preview content with isolated headers",
    async (kind, contentType, content) => {
      assetsService.getAssetForPreview.mockResolvedValue(
        kind === "pdf"
          ? {
              asset: { filename: "preview", sizeBytes: content.length },
              kind: "pdf",
              stream: { pipe: jest.fn() },
            }
          : { asset: { filename: "preview" }, kind, content },
      );

      await controller.previewAsset(
        "user-1",
        "asset-1",
        response as unknown as Response,
      );

      expect(assetsService.getAssetForPreview).toHaveBeenCalledWith(
        "user-1",
        "asset-1",
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Type",
        contentType,
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Content-Security-Policy",
        "sandbox",
      );
      expect(response.setHeader).toHaveBeenCalledWith(
        "Cache-Control",
        PRIVATE_IMMUTABLE_CACHE_CONTROL,
      );
      if (kind === "pdf") {
        expect(response.send).not.toHaveBeenCalled();
      } else {
        expect(response.send).toHaveBeenCalledWith(content);
      }
    },
  );

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
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cache-Control",
      PRIVATE_NO_STORE_CACHE_CONTROL,
    );
    expect(response.send).toHaveBeenCalledWith("# 第一讲\n");
  });
});
