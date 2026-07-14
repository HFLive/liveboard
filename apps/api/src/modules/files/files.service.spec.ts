import { ForbiddenException } from "@nestjs/common";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { FilesService } from "./files.service";

describe("FilesService", () => {
  const permissions = {
    getEffectiveLevelForFile: jest.fn(),
    getEffectiveLevelForFolder: jest.fn(),
    getEffectiveLevelsForFiles: jest.fn(),
  };
  const tx = {
    contentBlock: {
      findFirst: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
    },
    file: { create: jest.fn(), update: jest.fn() },
  };
  const prisma = {
    file: { findUnique: jest.fn() },
    folder: { findUnique: jest.fn() },
    fileAsset: { findUnique: jest.fn() },
    contentBlock: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  let service: FilesService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new FilesService(
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
    );
    permissions.getEffectiveLevelForFile.mockResolvedValue("editor");
    prisma.file.findUnique.mockResolvedValue({ workspaceId: "workspace-1" });
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      workspaceId: "workspace-1",
      uploadedBy: "owner-1",
      fileId: "source-file",
      folderId: null,
    });
    tx.contentBlock.findFirst.mockResolvedValue(null);
    tx.contentBlock.create.mockResolvedValue({ id: "block-1" });
    tx.file.create.mockResolvedValue({
      id: "imported-file",
      folderId: "folder-1",
      title: "课程",
      type: "doc",
      status: "draft",
      updatedAt: new Date("2026-07-14T00:00:00.000Z"),
    });
    prisma.$transaction.mockImplementation((callback) => callback(tx));
  });

  it("rejects re-sharing an asset without edit permission on its source", async () => {
    permissions.getEffectiveLevelForFile
      .mockResolvedValueOnce("editor")
      .mockResolvedValueOnce("viewer");

    await expect(
      service.createBlock("editor-1", "target-file", {
        type: "image",
        dataJson: { assetId: "asset-1", url: "/api/assets/asset-1" },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates the block and bumps its file version atomically", async () => {
    await service.createBlock("owner-1", "target-file", {
      type: "attachment",
      dataJson: { assetId: "asset-1" },
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.contentBlock.create).toHaveBeenCalled();
    expect(tx.file.update).toHaveBeenCalledWith({
      where: { id: "target-file" },
      data: { version: { increment: 1 }, updatedById: "owner-1" },
    });
  });

  it("validates table dimensions and math payloads before writing", async () => {
    await expect(
      service.createBlock("owner-1", "target-file", {
        type: "table",
        dataJson: { rows: [Array(21).fill("")] },
      }),
    ).rejects.toThrow("表格每行必须包含 1 至 20 列");
    await expect(
      service.createBlock("owner-1", "target-file", {
        type: "math",
        dataJson: { text: 42 },
      }),
    ).rejects.toThrow("数学公式必须是 50000 字符以内的文本");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects an asset from another workspace", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      workspaceId: "workspace-2",
      uploadedBy: "editor-1",
      fileId: null,
      folderId: null,
    });

    await expect(
      service.createBlock("editor-1", "target-file", {
        type: "image",
        dataJson: { assetId: "asset-1" },
      }),
    ).rejects.toThrow("附件不存在或不属于当前工作区");
  });

  it("imports a UTF-8 Markdown file and all blocks in one transaction", async () => {
    permissions.getEffectiveLevelForFolder.mockResolvedValue("editor");
    prisma.folder.findUnique.mockResolvedValue({
      id: "folder-1",
      workspaceId: "workspace-1",
    });

    const result = await service.importMarkdown("editor-1", {
      folderId: "folder-1",
      originalname: "课程.md",
      size: Buffer.byteLength("# 标题\n\n正文"),
      buffer: Buffer.from("# 标题\n\n正文"),
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.file.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        folderId: "folder-1",
        title: "课程",
        type: "doc",
      }),
    });
    expect(tx.contentBlock.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ type: "heading_1", sortOrder: 10 }),
        expect.objectContaining({ type: "paragraph", sortOrder: 20 }),
      ],
    });
    expect(result).toMatchObject({ blockCount: 2, warnings: [] });
  });

  it("rejects Markdown import without folder edit permission", async () => {
    permissions.getEffectiveLevelForFolder.mockResolvedValue("viewer");

    await expect(
      service.importMarkdown("viewer-1", {
        folderId: "folder-1",
        originalname: "课程.md",
        size: 4,
        buffer: Buffer.from("正文"),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects non-Markdown and oversized uploads before permission checks", async () => {
    await expect(
      service.importMarkdown("editor-1", {
        folderId: "folder-1",
        originalname: "课程.txt",
        size: 4,
        buffer: Buffer.from("正文"),
      }),
    ).rejects.toThrow("只支持上传 .md 文件");

    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    await expect(
      service.importMarkdown("editor-1", {
        folderId: "folder-1",
        originalname: "课程.md",
        size: oversized.length,
        buffer: oversized,
      }),
    ).rejects.toThrow("Markdown 文件不能超过 2 MB");
    expect(permissions.getEffectiveLevelForFolder).not.toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 and too many blocks before creating a file", async () => {
    permissions.getEffectiveLevelForFolder.mockResolvedValue("editor");
    prisma.folder.findUnique.mockResolvedValue({
      id: "folder-1",
      workspaceId: "workspace-1",
    });

    await expect(
      service.importMarkdown("editor-1", {
        folderId: "folder-1",
        originalname: "invalid.md",
        size: 2,
        buffer: Buffer.from([0xc3, 0x28]),
      }),
    ).rejects.toThrow("Markdown 文件必须使用 UTF-8 编码");

    const excessive = Array.from({ length: 2001 }, () => "正文").join("\n\n");
    await expect(
      service.importMarkdown("editor-1", {
        folderId: "folder-1",
        originalname: "large.md",
        size: Buffer.byteLength(excessive),
        buffer: Buffer.from(excessive),
      }),
    ).rejects.toThrow("Markdown 内容块不能超过 2000 个");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("exports ordered blocks after applying normal view and draft permissions", async () => {
    permissions.getEffectiveLevelForFile.mockResolvedValue("editor");
    prisma.file.findUnique.mockResolvedValue({
      id: "file-1",
      title: "第一讲/简介",
      status: "draft",
    });
    prisma.contentBlock.findMany.mockResolvedValue([
      { type: "heading_1", dataJson: { text: "开始" } },
      { type: "paragraph", dataJson: { text: "正文" } },
    ]);

    await expect(service.exportMarkdown("editor-1", "file-1")).resolves.toEqual(
      {
        filename: "第一讲-简介.md",
        content: "# 开始\n\n正文\n",
      },
    );
    expect(prisma.contentBlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { fileId: "file-1" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      }),
    );

    permissions.getEffectiveLevelForFile.mockResolvedValue("viewer");
    await expect(
      service.exportMarkdown("viewer-1", "file-1"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
