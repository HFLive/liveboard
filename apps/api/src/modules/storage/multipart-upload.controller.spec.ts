import type { PrismaService } from "../prisma/prisma.service";
import type { StorageService } from "./storage.service";
import { MultipartUploadController } from "./multipart-upload.controller";

describe("MultipartUploadController", () => {
  const pending = {
    id: "upload-1",
    uploadedBy: "user-1",
    expiresAt: new Date(Date.now() + 60_000),
    storageBackend: "minio",
    storageKey: "workspace/large.bin",
    sizeBytes: 8 * 1024 * 1024 + 3,
  } as never;
  const prisma = { pendingUpload: { findUnique: jest.fn() } };
  const storage = {
    presignMultipartPartForPending: jest.fn(),
    uploadMultipartPartForPending: jest.fn(),
    discardPendingUpload: jest.fn(),
  };
  let controller: MultipartUploadController;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.pendingUpload.findUnique.mockResolvedValue(pending);
    storage.presignMultipartPartForPending.mockResolvedValue({
      url: "https://oss.example/part-1",
      headers: {},
    });
    storage.uploadMultipartPartForPending.mockResolvedValue({ etag: "etag-1" });
    controller = new MultipartUploadController(
      prisma as unknown as PrismaService,
      storage as unknown as StorageService,
    );
  });

  it("signs a part only for the authenticated pending upload", async () => {
    await expect(
      controller.signPartUrl("user-1", "upload-1", "1", {
        sizeBytes: 8 * 1024 * 1024,
      }),
    ).resolves.toEqual({
      url: "https://oss.example/part-1",
      headers: {},
    });
    expect(storage.presignMultipartPartForPending).toHaveBeenCalledWith(
      pending,
      1,
      8 * 1024 * 1024,
    );
  });

  it("streams a relay part to storage before returning success", async () => {
    const request = {
      headers: { "content-length": "3" },
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("abc");
      },
    } as never;

    await expect(
      controller.uploadPart("user-1", "upload-1", "2", request),
    ).resolves.toEqual({ ok: true, partNumber: 2 });
    expect(storage.uploadMultipartPartForPending).toHaveBeenCalledWith(
      pending,
      2,
      Buffer.from("abc"),
    );
  });
});
