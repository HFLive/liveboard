import type { Request, Response } from "express";

/**
 * 把浏览器断开连接转换为可传入服务层的 AbortSignal。
 * 正常响应也会触发 close，因此只有响应尚未写完时才视为中断。
 */
export function createRequestAbortSignal(request: Request, response: Response) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortOnEarlyClose = () => {
    if (!response.writableEnded) abort();
  };

  request.once("aborted", abort);
  response.once("close", abortOnEarlyClose);

  return {
    signal: controller.signal,
    dispose() {
      request.off("aborted", abort);
      response.off("close", abortOnEarlyClose);
    },
  };
}
