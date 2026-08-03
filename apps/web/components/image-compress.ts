export interface ImageCompressOptions {
  /** 最长边上限（px）。小于该值不放大，只压缩。 */
  maxEdge: number;
  /** WebP 编码质量，0~1。 */
  quality: number;
  /** 输出文件名（以 .webp 结尾）。 */
  outputFileName: string;
}

/** 将 canvas 编码为 WebP 文件。所有图片压缩共享的收尾步骤。 */
export async function canvasToWebPFile(
  canvas: HTMLCanvasElement,
  quality: number,
  outputFileName: string,
): Promise<File> {
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", quality);
  });
  if (!blob) {
    throw new Error("图片处理失败");
  }
  return new File([blob], outputFileName, { type: "image/webp" });
}

/**
 * 统一图片压缩：解码（尊重 EXIF 方向）→ 按最长边缩放 → 编码为 WebP。
 * 图片小于 maxEdge 时不做放大，仅重新编码。
 */
export async function compressImageFile(
  file: File,
  options: ImageCompressOptions,
): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("只能选择图片文件");
  }

  const bitmap = await createImageBitmap(file, {
    imageOrientation: "from-image",
  });
  try {
    const scale = Math.min(
      1,
      options.maxEdge / Math.max(bitmap.width, bitmap.height),
    );
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("浏览器无法处理图片");
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvasToWebPFile(
      canvas,
      options.quality,
      options.outputFileName,
    );
  } finally {
    bitmap.close();
  }
}
