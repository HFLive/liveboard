import {
  RequestTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ObjectStorageBackend } from "./storage-backend";
import { putObjectWithCompensation } from "./upload-compensation";

describe("putObjectWithCompensation", () => {
  const backend = {
    name: "minio" as const,
    putObject: jest.fn(),
    getObject: jest.fn(),
    removeObject: jest.fn(),
    copyObject: jest.fn(),
    presignGet: jest.fn(),
    presignUpload: jest.fn(),
    presignPut: jest.fn(),
    statObject: jest.fn(),
    healthCheck: jest.fn(),
  } satisfies ObjectStorageBackend;
  const releaseReservation = jest.fn();

  beforeEach(() => {
    jest.resetAllMocks();
    backend.putObject.mockResolvedValue(undefined);
    backend.removeObject.mockResolvedValue(undefined);
    releaseReservation.mockResolvedValue(undefined);
  });

  it("does not start storage writes after the client has disconnected", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      putObjectWithCompensation({
        backend,
        storageKey: "workspace/file.pdf",
        data: Buffer.from("pdf"),
        mimeType: "application/pdf",
        signal: controller.signal,
        releaseReservation,
      }),
    ).rejects.toBeInstanceOf(RequestTimeoutException);

    expect(backend.putObject).not.toHaveBeenCalled();
    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("removes the completed object and reservation when disconnect is detected", async () => {
    const controller = new AbortController();
    backend.putObject.mockImplementation(async () => {
      controller.abort();
    });

    await expect(
      putObjectWithCompensation({
        backend,
        storageKey: "workspace/file.pdf",
        data: Buffer.from("pdf"),
        mimeType: "application/pdf",
        signal: controller.signal,
        releaseReservation,
      }),
    ).rejects.toBeInstanceOf(RequestTimeoutException);

    expect(backend.removeObject).toHaveBeenCalledWith("workspace/file.pdf");
    expect(releaseReservation).toHaveBeenCalledTimes(1);
  });

  it("keeps the reservation visible if an interrupted object cannot be removed", async () => {
    const controller = new AbortController();
    backend.putObject.mockImplementation(async () => {
      controller.abort();
    });
    backend.removeObject.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      putObjectWithCompensation({
        backend,
        storageKey: "workspace/file.pdf",
        data: Buffer.from("pdf"),
        mimeType: "application/pdf",
        signal: controller.signal,
        releaseReservation,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(releaseReservation).not.toHaveBeenCalled();
  });

  it("releases the reservation when the atomic object write fails", async () => {
    backend.putObject.mockRejectedValue(new Error("storage unavailable"));

    await expect(
      putObjectWithCompensation({
        backend,
        storageKey: "workspace/file.pdf",
        data: Buffer.from("pdf"),
        mimeType: "application/pdf",
        releaseReservation,
      }),
    ).rejects.toThrow("storage unavailable");

    expect(backend.removeObject).not.toHaveBeenCalled();
    expect(releaseReservation).toHaveBeenCalledTimes(1);
  });
});
