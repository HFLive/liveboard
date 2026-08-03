import { BadRequestException, ConflictException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import {
  AssetsService,
  getAssetPreviewKind,
  MAX_PDF_PREVIEW_SIZE_BYTES,
  normalizeAssetMimeType,
  readWebpDimensions,
} from "./assets.service";
import { PDF_PREVIEW_PRESIGN_EXPIRY_SECONDS } from "../storage/storage.service";

describe("asset preview classification", () => {
  it.each([
    ["handout.pdf", "application/pdf", "pdf"],
    ["notes.md", "application/octet-stream", "markdown"],
    ["readme.markdown", "text/plain", "markdown"],
    ["list.txt", "text/plain", "text"],
  ])("classifies %s with %s as %s", (filename, mimeType, expected) => {
    expect(getAssetPreviewKind(filename, mimeType)).toBe(expected);
  });

  it.each([
    ["fake.pdf.exe", "application/pdf"],
    ["page.html", "text/plain"],
    ["vector.svg", "text/plain"],
  ])("does not preview unsupported file %s", (filename, mimeType) => {
    expect(getAssetPreviewKind(filename, mimeType)).toBeNull();
  });
});

describe("asset MIME normalization", () => {
  const file = (name: string, mime: string, bytes: Buffer) => ({
    originalname: name,
    mimetype: mime,
    size: bytes.length,
    buffer: bytes,
  });

  it.each([
    ["attack.svg", "image/svg+xml", Buffer.from("<svg></svg>")],
    [
      "attack.txt",
      "text/plain",
      Buffer.from("  <?xml version='1.0'?><svg></svg>"),
    ],
    ["attack.png", "image/png", Buffer.from("<svg onload='alert(1)'></svg>")],
  ])(
    "rejects SVG content regardless of extension or declaration",
    (name, mime, bytes) => {
      expect(() => normalizeAssetMimeType(file(name, mime, bytes))).toThrow(
        BadRequestException,
      );
    },
  );

  it("trusts a PNG signature instead of a misleading declared type", () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);

    expect(normalizeAssetMimeType(file("photo.bin", "text/plain", png))).toBe(
      "image/png",
    );
  });

  it("downgrades an unrecognized image to a download-only type", () => {
    expect(
      normalizeAssetMimeType(
        file("unknown.bmp", "image/bmp", Buffer.from("not-a-bitmap")),
      ),
    ).toBe("application/octet-stream");
  });
});

describe("WebP dimension validation", () => {
  it("reads VP8X dimensions used by compressed forum images", () => {
    const webp = Buffer.alloc(30);
    webp.write("RIFF", 0, "ascii");
    webp.writeUInt32LE(22, 4);
    webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii");
    webp.writeUInt32LE(10, 16);
    webp.writeUIntLE(1599, 24, 3);
    webp.writeUIntLE(899, 27, 3);

    expect(readWebpDimensions(webp)).toEqual({ width: 1600, height: 900 });
  });

  it("rejects data without a valid WebP container", () => {
    expect(readWebpDimensions(Buffer.from("not-webp"))).toBeNull();
  });
});

describe("AssetsService consistency", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn(), findUnique: jest.fn() },
    forumPost: { findUnique: jest.fn(), findFirst: jest.fn() },
    file: { findUnique: jest.fn() },
    fileAsset: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    contentBlock: { findMany: jest.fn() },
    teachingDeckItem: { findMany: jest.fn(), findFirst: jest.fn() },
    folder: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const permissions = {
    getEffectiveLevelForFile: jest.fn(),
    getEffectiveLevelForFolder: jest.fn(),
  };
  const backend = {
    name: "minio" as const,
    putObject: jest.fn(),
    getObject: jest.fn(),
    removeObject: jest.fn(),
    presignGet: jest.fn(),
    healthCheck: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    presignDownload: jest.fn(),
    healthCheckActive: jest.fn(),
  };
  let service: AssetsService;

  beforeEach(() => {
    jest.resetAllMocks();
    backend.putObject.mockResolvedValue(undefined);
    backend.removeObject.mockResolvedValue(undefined);
    backend.presignGet.mockResolvedValue(null);
    storage.activeBackend.mockResolvedValue(backend);
    storage.backendFor.mockResolvedValue(backend);
    storage.presignDownload.mockResolvedValue(null);
    service = new AssetsService(
      { get: (_key: string, fallback?: unknown) => fallback } as ConfigService,
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
      storage as unknown as StorageService,
    );
    permissions.getEffectiveLevelForFile.mockResolvedValue("editor");
    permissions.getEffectiveLevelForFolder.mockResolvedValue("editor");
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.file.findUnique.mockResolvedValue({
      id: "file-1",
      workspaceId: "workspace-1",
      folderId: "folder-1",
      status: "draft",
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      username: "learner",
      displayName: "学习者",
      avatarUpdatedAt: null,
      systemRole: "member",
      status: "active",
    });
    prisma.teachingDeckItem.findMany.mockResolvedValue([]);
    prisma.fileAsset.delete.mockResolvedValue({ id: "asset-1" });
    backend.healthCheck.mockResolvedValue(undefined);
  });

  it("ignores references from archived files", async () => {
    prisma.fileAsset.findMany.mockResolvedValue([
      {
        id: "asset-1",
        uploadedBy: "user-1",
        uploader: {
          id: "user-1",
          username: "learner",
          displayName: "学习者",
          avatarUpdatedAt: null,
          systemRole: "member",
          status: "active",
        },
      },
    ]);
    prisma.contentBlock.findMany.mockResolvedValue([]);

    await service.listLibraryAssets("user-1");

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { uploadedBy: "user-1", forumPostId: null },
      }),
    );

    expect(prisma.contentBlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          file: { status: { not: "archived" } },
        }),
      }),
    );
  });

  it("allows an asset through a teaching deck visible to the user", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      uploadedBy: "teacher-1",
      folderId: null,
      fileId: null,
      forumPostId: null,
      storageKey: "asset-key",
    });
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      status: "active",
      systemRole: "member",
    });
    prisma.teachingDeckItem.findFirst.mockResolvedValue({ id: "item-1" });
    backend.getObject.mockResolvedValue({ pipe: jest.fn() });

    await expect(
      service.getAssetForDownload("learner-1", "asset-1"),
    ).resolves.toEqual(
      expect.objectContaining({
        asset: expect.objectContaining({ id: "asset-1" }),
      }),
    );
    expect(prisma.teachingDeckItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assetId: "asset-1",
          deck: expect.objectContaining({
            classroom: {
              members: { some: { userId: "learner-1" } },
            },
          }),
        }),
      }),
    );
  });

  it("does not let the uploader bypass revoked folder access", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      uploadedBy: "user-1",
      folderId: "folder-1",
      fileId: null,
      forumPostId: null,
      storageKey: "asset-key",
    });
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      status: "active",
      systemRole: "member",
    });
    permissions.getEffectiveLevelForFolder.mockResolvedValue("no_access");

    await expect(
      service.getAssetForDownload("user-1", "asset-1"),
    ).rejects.toThrow("No permission to view asset");
    expect(backend.getObject).not.toHaveBeenCalled();
  });

  it("returns a validated PDF preview through the permission path", async () => {
    const pdf = Buffer.from("%PDF-1.7\npreview");
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      uploadedBy: "teacher-1",
      folderId: "folder-1",
      fileId: null,
      forumPostId: null,
      storageKey: "asset-key",
      storageBackend: "minio",
      filename: "handout.pdf",
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
    });
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      status: "active",
      systemRole: "member",
    });
    permissions.getEffectiveLevelForFolder.mockResolvedValue("viewer");
    backend.getObject.mockResolvedValue(Readable.from([pdf]));

    const result = await service.getAssetForPreview("user-1", "asset-1");
    expect(result.kind).toBe("pdf");
    if (result.kind !== "pdf") throw new Error("expected pdf stream");
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    expect(Buffer.concat(chunks)).toEqual(pdf);
  });

  it("rejects invalid UTF-8 text instead of rendering it", async () => {
    const bytes = Buffer.from([0xc3, 0x28]);
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      uploadedBy: "teacher-1",
      folderId: "folder-1",
      fileId: null,
      forumPostId: null,
      storageKey: "asset-key",
      storageBackend: "minio",
      filename: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: bytes.length,
    });
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      status: "active",
      systemRole: "member",
    });
    permissions.getEffectiveLevelForFolder.mockResolvedValue("viewer");
    backend.getObject.mockResolvedValue(Readable.from([bytes]));

    await expect(
      service.getAssetForPreview("user-1", "asset-1"),
    ).rejects.toThrow("文本文件必须使用 UTF-8 编码");
  });

  describe("getAssetPreviewUrl", () => {
    function mockPdfAsset(sizeBytes = 1024) {
      prisma.fileAsset.findUnique.mockResolvedValue({
        id: "asset-1",
        uploadedBy: "user-1",
        folderId: "folder-1",
        fileId: null,
        forumPostId: null,
        storageKey: "asset-key",
        storageBackend: "minio",
        filename: "handout.pdf",
        mimeType: "application/pdf",
        sizeBytes,
      });
      prisma.contentBlock.findMany.mockResolvedValue([]);
      prisma.teachingDeckItem.findMany.mockResolvedValue([]);
      prisma.teachingDeckItem.findFirst.mockResolvedValue(null);
      prisma.user.findUnique.mockResolvedValue({
        status: "active",
        systemRole: "member",
      });
      permissions.getEffectiveLevelForFolder.mockResolvedValue("viewer");
    }

    it("returns a signed direct URL for PDFs when the backend presigns", async () => {
      mockPdfAsset();
      storage.presignDownload.mockResolvedValue(
        "https://r2.example/signed-pdf",
      );

      await expect(
        service.getAssetPreviewUrl("user-1", "asset-1"),
      ).resolves.toBe("https://r2.example/signed-pdf");
      expect(storage.presignDownload).toHaveBeenCalledWith(
        "minio",
        "asset-key",
        expect.objectContaining({
          filename: "handout.pdf",
          mimeType: "application/pdf",
          inline: true,
          expirySeconds: PDF_PREVIEW_PRESIGN_EXPIRY_SECONDS,
        }),
      );
    });

    it("returns null so the caller falls back to the proxy stream", async () => {
      mockPdfAsset();
      storage.presignDownload.mockResolvedValue(null);

      await expect(
        service.getAssetPreviewUrl("user-1", "asset-1"),
      ).resolves.toBeNull();
    });

    it("does not sign non-PDF previews", async () => {
      mockPdfAsset();
      prisma.fileAsset.findUnique.mockResolvedValue({
        id: "asset-1",
        uploadedBy: "user-1",
        folderId: "folder-1",
        fileId: null,
        forumPostId: null,
        storageKey: "asset-key",
        storageBackend: "minio",
        filename: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 128,
      });

      await expect(
        service.getAssetPreviewUrl("user-1", "asset-1"),
      ).resolves.toBeNull();
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });

    it("rejects PDFs over the preview size limit", async () => {
      mockPdfAsset(MAX_PDF_PREVIEW_SIZE_BYTES + 1);

      await expect(
        service.getAssetPreviewUrl("user-1", "asset-1"),
      ).rejects.toThrow("PDF 超过 25MB");
      expect(storage.presignDownload).not.toHaveBeenCalled();
    });
  });

  it("blocks deletion and returns the referencing teaching deck", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      uploadedBy: "user-1",
      forumPostId: null,
      storageKey: "asset-key",
    });
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findMany.mockResolvedValue([
      {
        id: "item-1",
        assetId: "asset-1",
        deck: { id: "deck-1", title: "课堂讲解" },
      },
    ]);

    await expect(
      service.deleteLibraryAsset("user-1", "asset-1"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(backend.removeObject).not.toHaveBeenCalled();
  });

  it("removes the reserved database row when object upload fails", async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          storageQuotaBytes: 1024,
        }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        create: jest.fn().mockResolvedValue({ id: "asset-1" }),
      },
      classroomFile: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    backend.putObject.mockRejectedValue(new Error("MinIO offline"));

    await expect(
      service.uploadAsset(
        "user-1",
        { fileId: "file-1" },
        {
          originalname: "notes.txt",
          mimetype: "text/plain",
          size: 5,
          buffer: Buffer.from("notes"),
        },
      ),
    ).rejects.toThrow("MinIO offline");
    expect(prisma.fileAsset.delete).toHaveBeenCalledWith({
      where: { id: "asset-1" },
    });
  });

  it("rejects duplicate attachment filenames in the same document", async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          storageQuotaBytes: 1024,
        }),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue({ id: "existing-asset" }),
        aggregate: jest.fn(),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(
      service.uploadAsset(
        "user-1",
        { fileId: "file-1" },
        {
          originalname: "notes.txt",
          mimetype: "text/plain",
          size: 5,
          buffer: Buffer.from("notes"),
        },
      ),
    ).rejects.toThrow("当前文档中已存在同名附件");
    expect(tx.fileAsset.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("limits replies to three images on the server", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      systemRole: "member",
    });
    prisma.forumPost.findUnique.mockResolvedValue({
      id: "post-1",
      threadId: "thread-1",
      authorId: "user-1",
      thread: { status: "open", workspaceId: "workspace-1" },
    });
    prisma.forumPost.findFirst.mockResolvedValue({ id: "main-post-1" });
    prisma.fileAsset.count.mockResolvedValue(3);

    await expect(
      service.uploadForumPostImages("user-1", "post-1", [
        {
          originalname: "image.webp",
          mimetype: "image/webp",
          size: 30,
          buffer: makeVp8xWebp(800, 600),
        },
      ]),
    ).rejects.toThrow("最多附带 3 张图片");
  });

  it("keeps the nine-image limit for the main post", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      systemRole: "member",
    });
    prisma.forumPost.findUnique.mockResolvedValue({
      id: "post-1",
      threadId: "thread-1",
      authorId: "user-1",
      thread: { status: "open", workspaceId: "workspace-1" },
    });
    prisma.forumPost.findFirst.mockResolvedValue({ id: "post-1" });
    prisma.fileAsset.count.mockResolvedValue(9);

    await expect(
      service.uploadForumPostImages("user-1", "post-1", [
        {
          originalname: "image.webp",
          mimetype: "image/webp",
          size: 30,
          buffer: makeVp8xWebp(800, 600),
        },
      ]),
    ).rejects.toThrow("最多附带 9 张图片");
  });

  it("rejects forum images whose real longest edge exceeds 1600px", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      status: "active",
      systemRole: "member",
    });
    prisma.forumPost.findUnique.mockResolvedValue({
      id: "post-1",
      threadId: "thread-1",
      authorId: "user-1",
      thread: { status: "open", workspaceId: "workspace-1" },
    });
    prisma.forumPost.findFirst.mockResolvedValue({ id: "post-1" });
    prisma.fileAsset.count.mockResolvedValue(0);

    await expect(
      service.uploadForumPostImages("user-1", "post-1", [
        {
          originalname: "image.webp",
          mimetype: "image/webp",
          size: 30,
          buffer: makeVp8xWebp(1601, 900),
        },
      ]),
    ).rejects.toThrow("图片最长边不能超过 1600px");
  });

  function mockStandaloneUpload() {
    prisma.folder.findUnique.mockResolvedValue({
      id: "folder-1",
      workspaceId: "workspace-1",
    });
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      storageQuotaBytes: null,
      status: "active",
      systemRole: "member",
    });
    prisma.workspace.findUnique.mockResolvedValue({
      id: "workspace-1",
      memberAttachmentQuotaBytes: null,
    });
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    prisma.fileAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
    prisma.fileAsset.create.mockResolvedValue({
      id: "asset-standalone-1",
      kind: "standalone",
    });
  }

  it("uploads standalone files into a folder for folder editors", async () => {
    mockStandaloneUpload();

    const result = await service.uploadAsset(
      "user-1",
      { folderId: "folder-1" },
      {
        originalname: "讲义.pdf",
        mimetype: "application/pdf",
        size: 5,
        buffer: Buffer.from("%PDF-"),
      },
    );

    expect(permissions.getEffectiveLevelForFolder).toHaveBeenCalledWith(
      "user-1",
      "folder-1",
    );
    expect(prisma.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "standalone",
        folderId: "folder-1",
        fileId: null,
      }),
    });
    expect(backend.putObject).toHaveBeenCalled();
    expect(result.kind).toBe("standalone");
  });

  it("rejects invalid standalone filenames instead of silently replacing them", async () => {
    mockStandaloneUpload();

    await expect(
      service.uploadAsset(
        "user-1",
        { folderId: "folder-1" },
        {
          originalname: "讲义\u200b.pdf",
          mimetype: "application/pdf",
          size: 5,
          buffer: Buffer.from("%PDF-"),
        },
      ),
    ).rejects.toThrow("文件名称不能包含换行、控制字符或不可见字符");
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("rejects duplicate standalone filenames in the same folder", async () => {
    mockStandaloneUpload();
    prisma.fileAsset.findFirst.mockResolvedValue({ id: "existing-asset" });

    await expect(
      service.uploadAsset(
        "user-1",
        { folderId: "folder-1" },
        {
          originalname: "讲义.pdf",
          mimetype: "application/pdf",
          size: 5,
          buffer: Buffer.from("%PDF-"),
        },
      ),
    ).rejects.toThrow("当前文件夹中已存在同名文件");
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
    expect(backend.putObject).not.toHaveBeenCalled();
  });

  it("applies the same duplicate check when renaming standalone files", async () => {
    prisma.fileAsset.findUnique.mockResolvedValue({
      id: "asset-1",
      kind: "standalone",
      folderId: "folder-1",
      uploadedBy: "user-1",
    });
    prisma.fileAsset.findFirst.mockResolvedValue({ id: "asset-2" });

    await expect(
      service.renameStandaloneAsset("user-1", "asset-1", "讲义.pdf"),
    ).rejects.toThrow("当前文件夹中已存在同名文件");
    expect(prisma.fileAsset.update).not.toHaveBeenCalled();
  });

  it("rejects standalone uploads of unsupported file types", async () => {
    mockStandaloneUpload();

    await expect(
      service.uploadAsset(
        "user-1",
        { folderId: "folder-1" },
        {
          originalname: "setup.exe",
          mimetype: "application/octet-stream",
          size: 5,
          buffer: Buffer.from("MZ123"),
        },
      ),
    ).rejects.toThrow("该类型不支持直接上传到文件夹");
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it("rejects standalone uploads without folder edit permission", async () => {
    mockStandaloneUpload();
    permissions.getEffectiveLevelForFolder.mockResolvedValue("viewer");

    await expect(
      service.uploadAsset(
        "user-1",
        { folderId: "folder-1" },
        {
          originalname: "讲义.pdf",
          mimetype: "application/pdf",
          size: 5,
          buffer: Buffer.from("%PDF-"),
        },
      ),
    ).rejects.toThrow("没有在此文件夹上传文件的权限");
    expect(prisma.fileAsset.create).not.toHaveBeenCalled();
  });

  it("only treats embedded assets as unreferenced cleanup candidates", async () => {
    prisma.fileAsset.findMany.mockResolvedValue([]);
    prisma.contentBlock.findMany.mockResolvedValue([]);

    await service.cleanupUnreferencedAssets(["asset-1"]);

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-1"] }, forumPostId: null, kind: "embedded" },
    });
  });

  it("cleans unreferenced standalone assets when includeStandalone is set", async () => {
    prisma.fileAsset.findMany.mockResolvedValue([
      {
        id: "asset-standalone-1",
        storageKey: "workspace/讲义.pdf",
        storageBackend: "r2",
      },
    ]);
    prisma.contentBlock.findMany.mockResolvedValue([]);

    await service.cleanupUnreferencedAssets(["asset-standalone-1"], {
      includeStandalone: true,
    });

    expect(prisma.fileAsset.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["asset-standalone-1"] }, forumPostId: null },
    });
    expect(backend.removeObject).toHaveBeenCalledWith("workspace/讲义.pdf");
    expect(prisma.fileAsset.delete).toHaveBeenCalledWith({
      where: { id: "asset-standalone-1" },
    });
  });

  it("keeps standalone assets still referenced by teaching decks", async () => {
    prisma.fileAsset.findMany.mockResolvedValue([
      {
        id: "asset-standalone-1",
        storageKey: "workspace/讲义.pdf",
        storageBackend: "r2",
      },
    ]);
    prisma.contentBlock.findMany.mockResolvedValue([]);
    prisma.teachingDeckItem.findMany.mockResolvedValue([
      {
        id: "item-1",
        assetId: "asset-standalone-1",
        deck: { id: "deck-1", title: "课堂讲解" },
      },
    ]);

    await service.cleanupUnreferencedAssets(["asset-standalone-1"], {
      includeStandalone: true,
    });

    expect(backend.removeObject).not.toHaveBeenCalled();
    expect(prisma.fileAsset.delete).not.toHaveBeenCalled();
  });
});

describe("AssetsService direct upload", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findUnique: jest.fn() },
    file: { findUnique: jest.fn() },
    folder: { findUnique: jest.fn() },
    fileAsset: {
      findFirst: jest.fn(),
      aggregate: jest.fn(),
    },
    pendingUpload: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      delete: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const permissions = {
    getEffectiveLevelForFile: jest.fn(),
    getEffectiveLevelForFolder: jest.fn(),
  };
  const backend = {
    name: "oss" as const,
    statObject: jest.fn(),
    removeObject: jest.fn(),
  };
  const storage = {
    activeBackend: jest.fn(),
    backendFor: jest.fn(),
    signUpload: jest.fn(),
    objectKeyForPendingUpload: jest.fn((_backend: string, key: string) => key),
    discardMultipartUpload: jest.fn(),
    verifyAndFinalizePendingObject: jest.fn(),
    discardPendingUpload: jest.fn(),
  };
  let service: AssetsService;

  const pendingRow = {
    id: "upload-1",
    kind: "asset" as const,
    workspaceId: "workspace-1",
    folderId: "folder-1",
    fileId: "file-1",
    classroomId: null,
    forumPostId: null,
    storageBackend: "oss" as const,
    filename: "notes.txt",
    mimeType: "text/plain",
    sizeBytes: 5,
    storageKey: "workspace-1/2026-07-29/abc-notes.txt",
    uploadedBy: "user-1",
    createdAt: new Date("2026-07-29T00:00:00Z"),
    expiresAt: new Date(Date.now() + 60_000),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AssetsService(
      { get: (_key: string, fallback?: unknown) => fallback } as ConfigService,
      prisma as unknown as PrismaService,
      permissions as unknown as PermissionsService,
      storage as unknown as StorageService,
    );
    storage.activeBackend.mockResolvedValue(backend);
    storage.backendFor.mockResolvedValue(backend);
    storage.objectKeyForPendingUpload.mockImplementation(
      (_backend: string, key: string) => key,
    );
    storage.signUpload.mockResolvedValue({
      transport: "form_post",
      url: "https://oss.example/upload",
      fields: { policy: "signed-policy" },
      expiresAt: "2026-07-29T00:10:00.000Z",
    });
    storage.verifyAndFinalizePendingObject.mockResolvedValue(undefined);
    storage.discardPendingUpload.mockResolvedValue(undefined);
    backend.statObject.mockResolvedValue({ size: 5 });
    backend.removeObject.mockResolvedValue(undefined);
    permissions.getEffectiveLevelForFile.mockResolvedValue("editor");
    permissions.getEffectiveLevelForFolder.mockResolvedValue("editor");
    prisma.file.findUnique.mockResolvedValue({
      id: "file-1",
      workspaceId: "workspace-1",
      folderId: "folder-1",
      status: "draft",
    });
    prisma.user.findUnique.mockResolvedValue({ storageQuotaBytes: null });
    prisma.workspace.findUnique.mockResolvedValue(null);
    prisma.fileAsset.findFirst.mockResolvedValue(null);
    prisma.fileAsset.aggregate.mockResolvedValue({ _sum: { sizeBytes: 0 } });
    prisma.pendingUpload.findMany.mockResolvedValue([]);
    prisma.pendingUpload.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 0 },
    });
    prisma.pendingUpload.create.mockResolvedValue(pendingRow);
    prisma.pendingUpload.findUnique.mockResolvedValue(pendingRow);
    prisma.pendingUpload.delete.mockResolvedValue(pendingRow);
  });

  it("signs a direct upload and reserves a pending row", async () => {
    const result = await service.signAssetUpload("user-1", {
      filename: "notes.txt",
      sizeBytes: 5,
      mimeType: "text/plain",
      fileId: "file-1",
    });

    expect(result).toEqual({
      uploadId: "upload-1",
      instruction: {
        transport: "form_post",
        url: "https://oss.example/upload",
        fields: { policy: "signed-policy" },
        expiresAt: "2026-07-29T00:10:00.000Z",
      },
      expiresAt: "2026-07-29T00:10:00.000Z",
    });
    expect(storage.signUpload).toHaveBeenCalledWith(
      "oss",
      expect.stringMatching(/^workspace-1\/\d{4}-\d{2}-\d{2}\/.+-notes\.txt$/),
      { sizeBytes: 5, mimeType: "text/plain" },
    );
    expect(prisma.pendingUpload.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "asset",
        workspaceId: "workspace-1",
        fileId: "file-1",
        filename: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        uploadedBy: "user-1",
        storageKey: expect.stringMatching(
          /^workspace-1\/\d{4}-\d{2}-\d{2}\/.+-notes\.txt$/,
        ),
      }),
    });
  });

  it("rejects SVG files without reading object content", async () => {
    await expect(
      service.signAssetUpload("user-1", {
        filename: "evil.svg",
        sizeBytes: 5,
        mimeType: "image/svg+xml",
        fileId: "file-1",
      }),
    ).rejects.toThrow("不支持上传 SVG 文件");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("rejects signing when the storage configuration has no direct upload", async () => {
    storage.signUpload.mockResolvedValue(null);

    await expect(
      service.signAssetUpload("user-1", {
        filename: "notes.txt",
        sizeBytes: 5,
        mimeType: "text/plain",
        fileId: "file-1",
      }),
    ).rejects.toThrow("当前存储配置不支持签名直入");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("counts unexpired pending uploads toward the quota pre-check", async () => {
    prisma.user.findUnique.mockResolvedValue({ storageQuotaBytes: 6 });
    prisma.pendingUpload.aggregate.mockResolvedValue({
      _sum: { sizeBytes: 4 },
    });

    await expect(
      service.signAssetUpload("user-1", {
        filename: "notes.txt",
        sizeBytes: 5,
        mimeType: "text/plain",
        fileId: "file-1",
      }),
    ).rejects.toThrow("文档附件容量不足");
    expect(prisma.pendingUpload.create).not.toHaveBeenCalled();
  });

  it("confirm creates the asset and releases the reservation", async () => {
    const created = {
      id: "asset-1",
      fileId: "file-1",
      filename: "notes.txt",
    };
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ storageQuotaBytes: 1024 }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        create: jest.fn().mockResolvedValue(created),
      },
      pendingUpload: { delete: jest.fn().mockResolvedValue(pendingRow) },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.confirmAssetUpload("user-1", "upload-1");

    expect(tx.fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        storageKey: pendingRow.storageKey,
        storageBackend: "oss",
        kind: "embedded",
        filename: "notes.txt",
        sizeBytes: 5,
      }),
    });
    expect(tx.pendingUpload.delete).toHaveBeenCalledWith({
      where: { id: "upload-1" },
    });
    expect(result.url).toContain("/assets/asset-1");
    expect(backend.removeObject).not.toHaveBeenCalled();
  });

  it("confirm discards the object when the size does not match", async () => {
    storage.verifyAndFinalizePendingObject.mockRejectedValue(
      new BadRequestException("上传内容不完整"),
    );

    await expect(
      service.confirmAssetUpload("user-1", "upload-1"),
    ).rejects.toThrow("上传内容不完整");
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirm discards the object when the quota reservation fails", async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ storageQuotaBytes: 1 }),
      },
      workspace: { findUnique: jest.fn().mockResolvedValue(null) },
      fileAsset: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        create: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    await expect(
      service.confirmAssetUpload("user-1", "upload-1"),
    ).rejects.toThrow("文档附件容量不足");
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);
  });

  it("confirm rejects an expired reservation and reaps it", async () => {
    prisma.pendingUpload.findUnique.mockResolvedValue({
      ...pendingRow,
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(
      service.confirmAssetUpload("user-1", "upload-1"),
    ).rejects.toThrow("上传任务已过期");
    expect(storage.discardPendingUpload).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("confirm rejects another user's reservation", async () => {
    await expect(
      service.confirmAssetUpload("user-2", "upload-1"),
    ).rejects.toThrow("上传任务不存在或已完成");
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("abort is idempotent and cleans up the object", async () => {
    await expect(
      service.abortAssetUpload("user-1", "upload-1"),
    ).resolves.toEqual({ ok: true });
    expect(storage.discardPendingUpload).toHaveBeenCalledWith(pendingRow);

    prisma.pendingUpload.findUnique.mockResolvedValue(null);
    storage.discardPendingUpload.mockClear();
    await expect(
      service.abortAssetUpload("user-1", "upload-1"),
    ).resolves.toEqual({ ok: true });
    expect(storage.discardPendingUpload).not.toHaveBeenCalled();
  });
});

function makeVp8xWebp(width: number, height: number) {
  const webp = Buffer.alloc(30);
  webp.write("RIFF", 0, "ascii");
  webp.writeUInt32LE(22, 4);
  webp.write("WEBP", 8, "ascii");
  webp.write("VP8X", 12, "ascii");
  webp.writeUInt32LE(10, 16);
  webp.writeUIntLE(width - 1, 24, 3);
  webp.writeUIntLE(height - 1, 27, 3);
  return webp;
}
