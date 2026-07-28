import type { ConfigService } from "@nestjs/config";
import type { AiSecretService } from "../ai/ai-secret.service";
import type { PrismaService } from "../prisma/prisma.service";
import { ATOMIC_UPLOAD_PART_SIZE_BYTES } from "./storage-backend";
import { StorageService } from "./storage.service";

const mockMinioClient = {
  listBuckets: jest.fn(),
  bucketExists: jest.fn(),
  getBucketRegionAsync: jest.fn(),
  makeBucket: jest.fn(),
  putObject: jest.fn(),
  getObject: jest.fn(),
  removeObject: jest.fn(),
  presignedGetObject: jest.fn(),
};

jest.mock("minio", () => ({
  Client: jest.fn(() => mockMinioClient),
}));

const { Client: MockedMinioClient } = jest.requireMock("minio") as {
  Client: jest.Mock;
};

describe("StorageService", () => {
  const prisma = {
    user: { findUnique: jest.fn() },
    workspace: { findFirst: jest.fn() },
    storageSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    classroomFile: { groupBy: jest.fn() },
    fileAsset: { groupBy: jest.fn() },
  };
  const secrets = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    isEncrypted: jest.fn(),
  };
  const config = {
    get: jest.fn((_key: string, fallback: unknown) => fallback),
  };
  let service: StorageService;

  const superAdmin = {
    id: "admin-1",
    systemRole: "super_admin",
    status: "active",
  };

  beforeEach(() => {
    jest.resetAllMocks();
    MockedMinioClient.mockImplementation(() => mockMinioClient);
    secrets.encrypt.mockImplementation((value: string) => `enc:${value}`);
    secrets.decrypt.mockImplementation((value: string) =>
      value.startsWith("enc:") ? value.slice(4) : value,
    );
    secrets.isEncrypted.mockImplementation((value: string) =>
      value.startsWith("enc:"),
    );
    config.get.mockImplementation(
      (_key: string, fallback: unknown) => fallback,
    );
    mockMinioClient.listBuckets.mockResolvedValue([]);
    mockMinioClient.bucketExists.mockResolvedValue(true);
    mockMinioClient.getBucketRegionAsync.mockResolvedValue("cn-hangzhou");
    mockMinioClient.makeBucket.mockResolvedValue(undefined);
    mockMinioClient.putObject.mockResolvedValue(undefined);
    mockMinioClient.removeObject.mockResolvedValue(undefined);
    mockMinioClient.presignedGetObject.mockResolvedValue(
      "https://oss.example/signed-url",
    );
    service = new StorageService(
      prisma as unknown as PrismaService,
      config as unknown as ConfigService,
      secrets as unknown as AiSecretService,
    );
    prisma.user.findUnique.mockResolvedValue(superAdmin);
    prisma.workspace.findFirst.mockResolvedValue({ id: "workspace-1" });
    prisma.storageSettings.findUnique.mockResolvedValue(null);
    prisma.classroomFile.groupBy.mockResolvedValue([]);
    prisma.fileAsset.groupBy.mockResolvedValue([]);
  });

  it("returns MinIO defaults when no settings row exists", async () => {
    await expect(service.getSettingsForAdmin("admin-1")).resolves.toMatchObject(
      {
        backend: "minio",
        downloadMode: "proxy",
        activeBackendHealthy: true,
        oss: { secretConfigured: false },
      },
    );
  });

  it("keeps supported uploads below the storage SDK multipart threshold", () => {
    expect(MockedMinioClient).toHaveBeenCalledWith(
      expect.objectContaining({
        partSize: ATOMIC_UPLOAD_PART_SIZE_BYTES,
      }),
    );
  });

  it("aggregates file counts and sizes per storage backend", async () => {
    prisma.classroomFile.groupBy.mockResolvedValue([
      {
        storageBackend: "minio",
        _count: { _all: 3 },
        _sum: { sizeBytes: 100 },
      },
    ]);
    prisma.fileAsset.groupBy.mockResolvedValue([
      {
        storageBackend: "minio",
        _count: { _all: 2 },
        _sum: { sizeBytes: 60 },
      },
      {
        storageBackend: "oss",
        _count: { _all: 4 },
        _sum: { sizeBytes: null },
      },
    ]);

    const result = await service.getSettingsForAdmin("admin-1");

    expect(result.fileDistribution).toEqual({
      minio: { count: 5, bytes: 160 },
      oss: { count: 4, bytes: 0 },
    });
  });

  it("rejects storage settings from non super admins", async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      systemRole: "admin",
      status: "active",
    });

    await expect(service.getSettingsForAdmin("user-1")).rejects.toThrow(
      "只有最高管理员可以管理存储设置",
    );
    await expect(
      service.updateSettings("user-1", { backend: "minio" }),
    ).rejects.toThrow("只有最高管理员可以管理存储设置");
  });

  it("keeps the stored OSS secret when switching back to MinIO", async () => {
    prisma.storageSettings.findUnique.mockResolvedValue({
      backend: "oss",
      downloadMode: "direct",
      ossRegion: "cn-hangzhou",
      ossBucket: "liveboard",
      ossEndpoint: null,
      ossInternal: false,
      ossAccessKeyId: "ak",
      ossAccessKeySecret: "enc:old-secret",
      updatedAt: new Date("2026-07-27T00:00:00Z"),
    });
    prisma.storageSettings.upsert.mockResolvedValue({
      backend: "minio",
      downloadMode: "proxy",
      ossRegion: "cn-hangzhou",
      ossBucket: "liveboard",
      ossEndpoint: null,
      ossInternal: false,
      ossAccessKeyId: "ak",
      ossAccessKeySecret: "enc:old-secret",
      updatedAt: new Date("2026-07-27T01:00:00Z"),
    });

    const result = await service.updateSettings("admin-1", {
      backend: "minio",
      downloadMode: "proxy",
    });

    expect(secrets.encrypt).not.toHaveBeenCalled();
    expect(mockMinioClient.putObject).not.toHaveBeenCalled();
    expect(prisma.storageSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          backend: "minio",
          ossAccessKeySecret: "enc:old-secret",
        }),
      }),
    );
    expect(result.backend).toBe("minio");
  });

  it("rejects enabling OSS with an incomplete configuration", async () => {
    await expect(
      service.updateSettings("admin-1", {
        backend: "oss",
        oss: { region: "cn-hangzhou" },
      }),
    ).rejects.toThrow("启用阿里云 OSS 前请完整填写地域、Bucket 和访问凭证");
    expect(prisma.storageSettings.upsert).not.toHaveBeenCalled();
  });

  it("rejects direct downloads through an internal OSS endpoint", async () => {
    await expect(
      service.updateSettings("admin-1", {
        backend: "oss",
        downloadMode: "direct",
        oss: {
          region: "cn-hangzhou",
          bucket: "liveboard",
          internal: true,
          accessKeyId: "ak",
          accessKeySecret: "raw-secret",
        },
      }),
    ).rejects.toThrow(
      "签名直出需要浏览器访问公网 Endpoint，不能使用内网 Endpoint",
    );
    expect(mockMinioClient.putObject).not.toHaveBeenCalled();
    expect(prisma.storageSettings.upsert).not.toHaveBeenCalled();
  });

  it("probes OSS with a real write before saving the configuration", async () => {
    prisma.storageSettings.upsert.mockResolvedValue({
      backend: "oss",
      downloadMode: "direct",
      ossRegion: "cn-hangzhou",
      ossBucket: "liveboard",
      ossEndpoint: null,
      ossInternal: false,
      ossAccessKeyId: "ak",
      ossAccessKeySecret: "enc:raw-secret",
      updatedAt: new Date("2026-07-27T01:00:00Z"),
    });

    const result = await service.updateSettings("admin-1", {
      backend: "oss",
      downloadMode: "direct",
      oss: {
        region: "cn-hangzhou",
        bucket: "liveboard",
        accessKeyId: "ak",
        accessKeySecret: "raw-secret",
      },
    });

    expect(mockMinioClient.putObject).toHaveBeenCalledWith(
      "liveboard",
      expect.stringMatching(/^site\/storage-probe\//),
      expect.any(Buffer),
      expect.any(Number),
      expect.objectContaining({ "Content-Type": "text/plain" }),
    );
    expect(mockMinioClient.removeObject).toHaveBeenCalledWith(
      "liveboard",
      expect.stringMatching(/^site\/storage-probe\//),
    );
    expect(prisma.storageSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          backend: "oss",
          ossAccessKeySecret: "enc:raw-secret",
        }),
      }),
    );
    expect(result.oss.secretConfigured).toBe(true);
  });

  it("rejects saving when the OSS probe fails", async () => {
    mockMinioClient.putObject.mockRejectedValue(
      new Error("SignatureDoesNotMatch"),
    );

    await expect(
      service.updateSettings("admin-1", {
        backend: "oss",
        oss: {
          region: "cn-hangzhou",
          bucket: "liveboard",
          accessKeyId: "ak",
          accessKeySecret: "raw-secret",
        },
      }),
    ).rejects.toThrow("无法连接阿里云 OSS");
    expect(prisma.storageSettings.upsert).not.toHaveBeenCalled();
  });

  it("returns null for presigned downloads in proxy mode", async () => {
    await expect(
      service.presignDownload("minio", "some/key", {
        filename: "a.pdf",
        mimeType: "application/pdf",
        inline: false,
      }),
    ).resolves.toBeNull();
    expect(mockMinioClient.presignedGetObject).not.toHaveBeenCalled();
  });

  it("falls back to proxy downloads for a legacy direct and internal configuration", async () => {
    prisma.storageSettings.findUnique.mockResolvedValue({
      backend: "oss",
      downloadMode: "direct",
      ossRegion: "cn-hangzhou",
      ossBucket: "liveboard",
      ossEndpoint: null,
      ossInternal: true,
      ossAccessKeyId: "ak",
      ossAccessKeySecret: "enc:raw-secret",
      updatedAt: new Date("2026-07-27T00:00:00Z"),
    });

    await expect(
      service.presignDownload("oss", "some/key", {
        filename: "a.pdf",
        mimeType: "application/pdf",
        inline: false,
      }),
    ).resolves.toBeNull();
    expect(mockMinioClient.presignedGetObject).not.toHaveBeenCalled();
  });

  it("presigns downloads from OSS in direct mode", async () => {
    prisma.storageSettings.findUnique.mockResolvedValue({
      backend: "oss",
      downloadMode: "direct",
      ossRegion: "cn-hangzhou",
      ossBucket: "liveboard",
      ossEndpoint: null,
      ossInternal: false,
      ossAccessKeyId: "ak",
      ossAccessKeySecret: "enc:raw-secret",
      updatedAt: new Date("2026-07-27T00:00:00Z"),
    });

    await expect(
      service.presignDownload("oss", "ws/classrooms/c1/a.pdf", {
        filename: "讲义.pdf",
        mimeType: "application/pdf",
        inline: false,
      }),
    ).resolves.toBe("https://oss.example/signed-url");
    expect(mockMinioClient.presignedGetObject).toHaveBeenCalledWith(
      "liveboard",
      "ws/classrooms/c1/a.pdf",
      600,
      expect.objectContaining({
        "response-content-disposition": expect.stringContaining("attachment"),
      }),
    );
    const respHeaders = mockMinioClient.presignedGetObject.mock.calls[0]?.[3];
    expect(respHeaders).not.toHaveProperty("response-content-type");
  });

  it("fails downloads for OSS objects when OSS is no longer configured", async () => {
    await expect(service.backendFor("oss")).rejects.toThrow(
      "阿里云 OSS 尚未正确配置",
    );
  });

  it("requires a complete configuration for connection tests", async () => {
    await expect(
      service.testConnection("admin-1", { region: "cn-hangzhou" }),
    ).rejects.toThrow(
      "请完整填写地域、Bucket、AccessKey ID 和 AccessKey Secret",
    );
  });
});
