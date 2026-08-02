/**
 * URL 自身包含版本号，或资源 ID 永久对应同一份对象内容。
 * `private` 防止共享代理缓存带权限的用户资源。
 */
export const PRIVATE_IMMUTABLE_CACHE_CONTROL =
  "private, max-age=31536000, immutable";

/** 公开且通过版本化 URL 更新的静态资源。 */
export const PUBLIC_IMMUTABLE_CACHE_CONTROL =
  "public, max-age=31536000, immutable";

/**
 * 响应可以存入浏览器缓存，但每次使用前必须向服务端校验。
 * Express 的 ETag 可让未变化的公共设置只返回 304。
 */
export const PUBLIC_REVALIDATED_CACHE_CONTROL = "public, no-cache";

/** 私有资源允许浏览器保存，但固定 URL 每次使用前必须重新校验。 */
export const PRIVATE_REVALIDATED_CACHE_CONTROL = "private, no-cache";

/** 带权限且不应由浏览器复用的导出、附件和签名跳转响应。 */
export const PRIVATE_NO_STORE_CACHE_CONTROL = "private, no-store";

export function isVersionedResourceRequest(version: string | undefined) {
  return typeof version === "string" && /^\d+$/.test(version);
}
