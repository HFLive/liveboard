import type { Response } from "express";
import { ClassroomsController } from "./classrooms.controller";
import type { ClassroomsService } from "./classrooms.service";

describe("ClassroomsController file preview", () => {
  const classroomsService = {
    downloadFile: jest.fn(),
    previewFile: jest.fn(),
  };
  const response = {
    redirect: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
  };
  let controller: ClassroomsController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new ClassroomsController(
      classroomsService as unknown as ClassroomsService,
    );
  });

  it.each([
    ["pdf", "application/pdf", Buffer.from("%PDF-1.7")],
    ["markdown", "text/markdown; charset=utf-8", "# 标题"],
    ["text", "text/plain; charset=utf-8", "正文"],
  ])("returns a protected %s preview", async (kind, contentType, content) => {
    classroomsService.previewFile.mockResolvedValue({
      file: { filename: "preview" },
      kind,
      content,
    });

    await controller.previewFile(
      "user-1",
      "classroom-1",
      "file-1",
      response as unknown as Response,
    );

    expect(classroomsService.previewFile).toHaveBeenCalledWith(
      "user-1",
      "classroom-1",
      "file-1",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      contentType,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Security-Policy",
      "sandbox",
    );
    expect(response.send).toHaveBeenCalledWith(content);
  });

  it("serves classroom images inline with a browser-renderable content type", async () => {
    const stream = { pipe: jest.fn() };
    classroomsService.downloadFile.mockResolvedValue({
      file: {
        filename: "课堂截图.png",
        mimeType: "image/png",
        sizeBytes: 4,
      },
      redirectUrl: null,
      stream,
    });

    await controller.downloadFile(
      "user-1",
      "classroom-1",
      "file-1",
      response as unknown as Response,
      "1",
    );

    expect(classroomsService.downloadFile).toHaveBeenCalledWith(
      "user-1",
      "classroom-1",
      "file-1",
      true,
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "image/png",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Cross-Origin-Resource-Policy",
      "same-site",
    );
    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      'inline; filename="%E8%AF%BE%E5%A0%82%E6%88%AA%E5%9B%BE.png"',
    );
    expect(stream.pipe).toHaveBeenCalledWith(response);
  });
});
