export type CropFrame = {
  x: number;
  y: number;
  width: number;
};

export type CropCorner = "nw" | "ne" | "sw" | "se";

export const MIN_CROP_WIDTH = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function cropFrameHeight(frame: CropFrame, aspect: number) {
  return frame.width / aspect;
}

/** 初始裁切框：居中并尽量铺满图片。 */
export function initialCropFrame(
  imageWidth: number,
  imageHeight: number,
  aspect: number,
): CropFrame {
  const width = Math.min(imageWidth, imageHeight * aspect);

  return {
    x: (imageWidth - width) / 2,
    y: (imageHeight - width / aspect) / 2,
    width,
  };
}

export function clampCropFrame(
  frame: CropFrame,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  minWidth = MIN_CROP_WIDTH,
): CropFrame {
  const maxWidth = Math.min(imageWidth, imageHeight * aspect);
  const width = clamp(frame.width, Math.min(minWidth, maxWidth), maxWidth);

  return {
    width,
    x: clamp(frame.x, 0, imageWidth - width),
    y: clamp(frame.y, 0, imageHeight - width / aspect),
  };
}

/** 拖动裁切框整体移动，图片本身不动。 */
export function moveCropFrame(
  frame: CropFrame,
  dx: number,
  dy: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
): CropFrame {
  return clampCropFrame(
    { ...frame, x: frame.x + dx, y: frame.y + dy },
    imageWidth,
    imageHeight,
    aspect,
  );
}

/** 拖动角手柄缩放裁切框：被拖动的角跟随指针，对角位置保持不动。 */
export function resizeCropFrame(
  frame: CropFrame,
  corner: CropCorner,
  pointerX: number,
  pointerY: number,
  imageWidth: number,
  imageHeight: number,
  aspect: number,
  minWidth = MIN_CROP_WIDTH,
): CropFrame {
  const isWest = corner === "nw" || corner === "sw";
  const isNorth = corner === "nw" || corner === "ne";
  const anchorX = isWest ? frame.x + frame.width : frame.x;
  const anchorY = isNorth ? frame.y + frame.width / aspect : frame.y;

  // 宽高按比例联动，取能覆盖指针位置的尺寸，使被拖动的角始终贴着指针。
  const widthFromX = Math.abs(pointerX - anchorX);
  const widthFromY = Math.abs(pointerY - anchorY) * aspect;

  const maxWidth = Math.min(
    isWest ? anchorX : imageWidth - anchorX,
    (isNorth ? anchorY : imageHeight - anchorY) * aspect,
  );
  const width = clamp(
    Math.max(widthFromX, widthFromY),
    Math.min(minWidth, maxWidth),
    maxWidth,
  );

  return {
    x: isWest ? anchorX - width : anchorX,
    y: isNorth ? anchorY - width / aspect : anchorY,
    width,
  };
}

/** 按显示坐标下的裁切框渲染最终图片文件。 */
export async function renderCroppedImageFile(
  image: HTMLImageElement,
  frame: CropFrame,
  displayedWidth: number,
  outputWidth: number,
  outputHeight: number,
  fileName: string,
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("浏览器无法处理图片");
  }

  const scale = image.naturalWidth / displayedWidth;
  const sourceX = frame.x * scale;
  const sourceY = frame.y * scale;
  const sourceWidth = frame.width * scale;
  const sourceHeight = sourceWidth * (outputHeight / outputWidth);

  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/webp", 0.9);
  });

  if (!blob) {
    throw new Error("图片处理失败");
  }

  return new File([blob], fileName, { type: "image/webp" });
}
