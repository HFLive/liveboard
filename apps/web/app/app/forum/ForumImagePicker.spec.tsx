import { afterEach, describe, expect, it, vi } from "vitest";
import { compressForumImage } from "./ForumImagePicker";

describe("forum image compression", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("scales the longest edge to 1600px and exports WebP", async () => {
    const close = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 2000, height: 1000, close }),
    );
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn().mockReturnValue({ drawImage }),
      toBlob: vi.fn((callback: BlobCallback) =>
        callback(new Blob(["compressed"], { type: "image/webp" })),
      ),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName) => {
      if (tagName === "canvas") return canvas as unknown as HTMLCanvasElement;
      return createElement(tagName);
    });

    const result = await compressForumImage(
      new File(["source"], "source.png", { type: "image/png" }),
      0,
    );

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 800);
    expect(result.type).toBe("image/webp");
    expect(close).toHaveBeenCalled();
  });
});
