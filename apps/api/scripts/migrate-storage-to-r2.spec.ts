import { Readable } from "node:stream";
import type { PrismaClient } from "@prisma/client";
import type { ObjectStorageBackend } from "../src/modules/storage/storage-backend";
import {
  migrateOne,
  type ObjectRef,
  type Summary,
} from "./migrate-storage-to-r2";

function summary(): Summary {
  return {
    total: 1,
    planned: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
    missing: 0,
    totalBytes: 0,
  };
}

function backend(name: "minio" | "r2", size: number) {
  return {
    name,
    statObject: jest.fn().mockResolvedValue({ size }),
    getObject: jest.fn().mockResolvedValue(Readable.from([Buffer.alloc(size)])),
    putObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as ObjectStorageBackend & {
    statObject: jest.Mock;
    getObject: jest.Mock;
    putObject: jest.Mock;
  };
}

function ref(
  updateBackend = jest.fn().mockResolvedValue(undefined),
): ObjectRef {
  return {
    kind: "avatar",
    recordKey: "user-1",
    storageKey: "avatars/user-1.webp",
    backend: "minio",
    expectedSize: null,
    mimeType: "image/webp",
    updateBackend,
  };
}

describe("migrate-storage-to-r2", () => {
  it("keeps dry-run read-only and reports the planned copy", async () => {
    const source = backend("minio", 12);
    const target = backend("r2", 3);
    const result = summary();
    const objectRef = ref();

    await migrateOne(
      {} as PrismaClient,
      target as never,
      source,
      null,
      objectRef,
      false,
      result,
    );

    expect(source.statObject).toHaveBeenCalledWith(objectRef.storageKey);
    expect(source.getObject).not.toHaveBeenCalled();
    expect(target.putObject).not.toHaveBeenCalled();
    expect(objectRef.updateBackend).not.toHaveBeenCalled();
    expect(result).toMatchObject({ planned: 1, migrated: 0, failed: 0 });
  });

  it("does not accept a same-key R2 object with a different source size", async () => {
    const source = backend("minio", 12);
    const target = backend("r2", 3);
    target.statObject
      .mockResolvedValueOnce({ size: 3 })
      .mockResolvedValue({ size: 12 });
    const result = summary();
    const objectRef = ref();

    await migrateOne(
      {} as PrismaClient,
      target as never,
      source,
      null,
      objectRef,
      true,
      result,
    );

    expect(target.putObject).toHaveBeenCalled();
    expect(objectRef.updateBackend).toHaveBeenCalled();
    expect(result).toMatchObject({ migrated: 1, skipped: 0, failed: 0 });
  });

  it("reports an existing-object database update failure", async () => {
    const source = backend("minio", 12);
    const target = backend("r2", 12);
    const updateBackend = jest.fn().mockRejectedValue(new Error("db offline"));
    const result = summary();

    await migrateOne(
      {} as PrismaClient,
      target as never,
      source,
      null,
      ref(updateBackend),
      true,
      result,
    );

    expect(target.putObject).not.toHaveBeenCalled();
    expect(result).toMatchObject({ failed: 1, skipped: 0 });
  });
});
