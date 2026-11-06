import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";

export interface EmbeddingConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  dimensions: number;
}

export function embeddingEndpoint(value: string) {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new BadRequestException("向量服务地址格式无效");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new BadRequestException(
      "向量服务地址须为不含凭据、查询参数或片段的 HTTP(S) 地址",
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/embeddings")) url.pathname += "/embeddings";
  return url.toString();
}

/** Never echo provider response bodies: they may contain credentials or document text. */
export async function embedTexts(
  config: EmbeddingConfig,
  input: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<number[][]> {
  const endpoint = embeddingEndpoint(config.baseUrl);
  if (!input.length || input.some((text) => !text.trim())) {
    throw new BadRequestException("向量输入不能为空");
  }
  const signal = AbortSignal.any([
    AbortSignal.timeout(options.timeoutMs ?? 20_000),
    ...(options.signal ? [options.signal] : []),
  ]);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + config.apiKey,
      },
      body: JSON.stringify({
        model: config.model,
        input,
        encoding_format: "float",
      }),
      redirect: "error",
      signal,
    });
    if (!response.ok) {
      throw new ServiceUnavailableException(
        "向量服务请求失败（HTTP " + response.status + "）",
      );
    }
    const body = (await response.json()) as {
      data?: Array<{ index: number; embedding: unknown }>;
    };
    if (!Array.isArray(body.data) || body.data.length !== input.length) {
      throw new ServiceUnavailableException("向量服务返回数量不匹配");
    }
    const result: number[][] = new Array(input.length);
    let dimensions = config.dimensions;
    for (const item of body.data) {
      if (
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= input.length ||
        result[item.index]
      ) {
        throw new ServiceUnavailableException("向量服务返回的序号无效");
      }
      const vector = item.embedding;
      if (
        !Array.isArray(vector) ||
        vector.length < 1 ||
        vector.length > 4096 ||
        vector.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        ) ||
        !vector.some((value) => value !== 0)
      ) {
        throw new ServiceUnavailableException(
          "向量服务返回了无效向量（支持 1–4096 维）",
        );
      }
      dimensions ||= vector.length;
      if (vector.length !== dimensions) {
        throw new ServiceUnavailableException(
          "向量维度发生变化，请重新保存向量模型配置",
        );
      }
      result[item.index] = vector;
    }
    signal.throwIfAborted();
    return result;
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof ServiceUnavailableException) throw error;
    throw new ServiceUnavailableException("无法连接向量服务或请求超时");
  }
}
