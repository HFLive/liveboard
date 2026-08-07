import sharp from "sharp";
import {
  IMAGE_MAX_EDGE_PX,
  IMAGE_WEBP_QUALITY,
  compressImageBuffer,
} from "./image-compress";

async function makePng(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 100, g: 150, b: 200 },
    },
  })
    .png()
    .toBuffer();
}

describe("compressImageBuffer", () => {
  it("passes non-image files through unchanged", async () => {
    const buffer = Buffer.from("hello");
    await expect(
      compressImageBuffer(buffer, "text/plain", "notes.txt"),
    ).resolves.toBeNull();
  });

  it("passes undecodable image bytes through unchanged", async () => {
    await expect(
      compressImageBuffer(Buffer.from("not-an-image"), "image/png", "a.png"),
    ).resolves.toBeNull();
  });

  it("compresses a large image to WebP within the max edge", async () => {
    const png = await makePng(2000, 1000);

    const result = await compressImageBuffer(
      png,
      "image/png",
      "photo.png",
    );

    expect(result).not.toBeNull();
    expect(result!.filename).toBe("photo.webp");
    expect(result!.mimeType).toBe("image/webp");
    const meta = await sharp(result!.buffer).metadata();
    expect(meta.format).toBe("webp");
    expect(Math.max(meta.width!, meta.height!)).toBe(IMAGE_MAX_EDGE_PX);
    expect(result!.buffer.length).toBeLessThan(png.length);
  });

  it("does not upscale small images", async () => {
    const png = await makePng(800, 600);

    const result = await compressImageBuffer(
      png,
      "image/png",
      "small.png",
    );

    expect(result).not.toBeNull();
    const meta = await sharp(result!.buffer).metadata();
    expect(meta.width).toBe(800);
    expect(meta.height).toBe(600);
  });

  it("derives the WebP filename from the source base name", async () => {
    const png = await makePng(100, 100);

    const result = await compressImageBuffer(png, "image/jpeg", "noext");

    expect(result!.filename).toBe("noext.webp");
  });

  it("uses the documented quality constant for encoding", () => {
    // sharp 的 quality 是 1~100，82 对应 Web 端 canvas.toBlob 的 0.82
    expect(IMAGE_WEBP_QUALITY).toBe(82);
  });
});
