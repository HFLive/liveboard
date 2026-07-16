import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
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
    workspace: { findFirst: jest.fn() },
    forumPost: { findUnique: jest.fn(), findFirst: jest.fn() },
    fileAsset: {
      findMany: jest.fn(),
      count: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
    },
    contentBlock: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const minio = {
    bucketExists: jest.fn(),
    makeBucket: jest.fn(),
    putObject: jest.fn(),
  };
  let service: AssetsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new AssetsService(
      { get: (_key: string, fallback?: unknown) => fallback } as ConfigService,
      prisma as unknown as PrismaService,
      {} as PermissionsService,
    );
    Object.assign(service as unknown as { minio: unknown }, { minio });
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.fileAsset.delete.mockResolvedValue({ id: "asset-1" });
    minio.bucketExists.mockResolvedValue(true);
  });

  it("ignores references from archived files", async () => {
    prisma.fileAsset.findMany.mockResolvedValue([
      { id: "asset-1", uploadedBy: "user-1" },
    ]);
    prisma.contentBlock.findMany.mockResolvedValue([]);

    await service.listLibraryAssets("user-1");

    expect(prisma.contentBlock.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          file: { status: { not: "archived" } },
        }),
      }),
    );
  });

  it("removes the reserved database row when object upload fails", async () => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          storageQuotaBytes: 1024,
        }),
      },
      fileAsset: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
        create: jest.fn().mockResolvedValue({ id: "asset-1" }),
      },
    };
    prisma.$transaction.mockImplementation((callback) => callback(tx));
    minio.putObject.mockRejectedValue(new Error("MinIO offline"));

    await expect(
      service.uploadAsset(
        "user-1",
        {},
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
