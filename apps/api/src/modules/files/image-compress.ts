import sharp, { type Metadata } from "sharp";

/**
 * 服务端图片压缩，参数与 Web 端 compressImageFile
 * （apps/web/components/image-compress.ts，文档内插入图片统一压缩为 WebP）
 * 保持一致：最长边 1600px（不放大）→ WebP 质量 0.82 → 自动按 EXIF 转正。
 * 注意：canvas.toBlob 的 quality 是 0~1，sharp 的 quality 是 1~100，
 * 这里存 82 即对应 Web 端的 0.82。
 */
export const IMAGE_MAX_EDGE_PX = 1600;
export const IMAGE_WEBP_QUALITY = 82;

export interface CompressedImage {
  buffer: Buffer;
  /** 压缩后的文件名（`<原基名>.webp`），由调用方传入原文件名派生。 */
  filename: string;
  mimeType: "image/webp";
}

/**
 * 将图片 buffer 压缩为 WebP。
 * - 非 `image/*` 返回 null（原样透传，与 Web 端一致）
 * - 解码失败（SVG、损坏文件）返回 null，交给后端校验拒绝或透传（与 Web 端
 *   compressDocumentImages 的 try/catch 语义一致）
 * - 小于 maxEdge 不放大，仅重新编码
 */
export async function compressImageBuffer(
  buffer: Buffer,
  sourceMimeType: string,
  sourceFilename: string,
): Promise<CompressedImage | null> {
  if (!sourceMimeType.startsWith("image/")) {
    return null;
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    return null;
  }
  if (!metadata.width || !metadata.height) {
    return null;
  }

  const scale = Math.min(
    1,
    IMAGE_MAX_EDGE_PX / Math.max(metadata.width, metadata.height),
  );
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  let webp: Buffer;
  try {
    // rotate() 无参数即按 EXIF Orientation 转正，等价 Web 端
    // createImageBitmap 的 imageOrientation: "from-image"。
    webp = await sharp(buffer)
      .rotate()
      .resize(width, height)
      .webp({ quality: IMAGE_WEBP_QUALITY })
      .toBuffer();
  } catch {
    return null;
  }

  const base = sourceFilename.replace(/\.[^.]+$/, "") || "image";
  return {
    buffer: webp,
    filename: `${base}.webp`,
    mimeType: "image/webp",
  };
}
