import { BadRequestException, ConflictException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "../storage/storage.service";
import {
  AssetsService,
  normalizeAssetMimeType,
  readWebpDimensions,
} from "./assets.service";

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
