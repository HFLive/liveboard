import {
  RequestTimeoutException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ObjectStorageBackend } from "./storage-backend";

export function throwIfUploadInterrupted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new RequestTimeoutException("上传已取消");
  }
}

/**
 * 对“预留数据库记录 -> 写对象”流程提供补偿。
 * 若客户端在对象写入期间断开，会先删除对象，再释放数据库预留；
 * 如果对象清理失败则保留数据库记录，使残留仍可见、可由用户稍后删除。
 */
export async function putObjectWithCompensation(input: {
  backend: ObjectStorageBackend;
  storageKey: string;
  data: Buffer;
  mimeType: string;
  signal?: AbortSignal;
  releaseReservation: () => Promise<unknown>;
}) {
  throwIfUploadInterrupted(input.signal);
  let writeCompleted = false;

  try {
    await input.backend.putObject(input.storageKey, input.data, input.mimeType);
    writeCompleted = true;
    throwIfUploadInterrupted(input.signal);
  } catch (caught) {
    if (writeCompleted) {
      try {
        await input.backend.removeObject(input.storageKey);
      } catch (cleanupError) {
        throw new ServiceUnavailableException(
          "上传已中断，但自动清理暂未完成；文件记录已保留，可稍后手动删除",
          { cause: cleanupError },
        );
      }
    }

    await input.releaseReservation().catch(() => undefined);
    throw caught;
  }
}
