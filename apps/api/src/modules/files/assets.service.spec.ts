import { BadRequestException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { PermissionsService } from "../permissions/permissions.service";
import type { PrismaService } from "../prisma/prisma.service";
import { AssetsService, normalizeAssetMimeType } from "./assets.service";

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

describe("AssetsService consistency", () => {
  const prisma = {
    workspace: { findFirst: jest.fn() },
    fileAsset: { findMany: jest.fn(), delete: jest.fn() },
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
});
