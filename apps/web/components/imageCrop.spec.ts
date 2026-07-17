import { describe, expect, it } from "vitest";
import {
  clampCropFrame,
  cropFrameHeight,
  initialCropFrame,
  moveCropFrame,
  resizeCropFrame,
} from "./imageCrop";

describe("imageCrop", () => {
  it("creates a centered initial frame that fills the image", () => {
    expect(initialCropFrame(800, 600, 1)).toEqual({
      x: 100,
      y: 0,
      width: 600,
    });
    expect(initialCropFrame(800, 100, 4)).toEqual({
      x: 200,
      y: 0,
      width: 400,
    });
    expect(initialCropFrame(500, 500, 4)).toEqual({
      x: 0,
      y: 187.5,
      width: 500,
    });
  });

  it("moves the frame within image bounds", () => {
    const frame = { x: 100, y: 50, width: 200 };

    expect(moveCropFrame(frame, 30, 20, 800, 600, 1)).toEqual({
      x: 130,
      y: 70,
      width: 200,
    });
    expect(moveCropFrame(frame, -500, -500, 800, 600, 1)).toEqual({
      x: 0,
      y: 0,
      width: 200,
    });
    expect(moveCropFrame(frame, 1000, 1000, 800, 600, 1)).toEqual({
      x: 600,
      y: 400,
      width: 200,
    });
  });

  it("resizes from the south-east corner keeping the opposite corner fixed", () => {
    const frame = { x: 100, y: 100, width: 200 };
    const resized = resizeCropFrame(frame, "se", 350, 350, 800, 600, 1);

    expect(resized).toEqual({ x: 100, y: 100, width: 250 });
    expect(cropFrameHeight(resized, 1)).toBe(250);
  });

  it("resizes from the north-west corner keeping the bottom-right fixed", () => {
    const frame = { x: 100, y: 100, width: 200 };
    const resized = resizeCropFrame(frame, "nw", 150, 150, 800, 600, 1);

    expect(resized).toEqual({ x: 150, y: 150, width: 150 });
  });

  it("grows when dragging the north-east corner upward", () => {
    const frame = { x: 100, y: 100, width: 200 };
    // 锚点在左下 (100, 300)，指针向上拖到 (300, 50)
    const resized = resizeCropFrame(frame, "ne", 300, 50, 800, 600, 1);

    expect(resized).toEqual({ x: 100, y: 50, width: 250 });
  });

  it("grows when dragging the south-west corner downward", () => {
    const frame = { x: 100, y: 100, width: 200 };
    // 锚点在右上 (300, 100)，指针向下拖到 (50, 350)
    const resized = resizeCropFrame(frame, "sw", 50, 350, 800, 600, 1);

    expect(resized).toEqual({ x: 50, y: 100, width: 250 });
  });

  it("locks the aspect ratio for wide crops using the dominant axis", () => {
    const frame = { x: 0, y: 100, width: 400 };
    const resized = resizeCropFrame(frame, "se", 500, 225, 800, 600, 4);

    expect(resized.width).toBe(500);
    expect(cropFrameHeight(resized, 4)).toBe(125);
  });

  it("never grows beyond the image or below the minimum size", () => {
    const frame = { x: 100, y: 100, width: 200 };

    expect(resizeCropFrame(frame, "se", 10000, 10000, 800, 600, 1)).toEqual({
      x: 100,
      y: 100,
      width: 500,
    });
    expect(resizeCropFrame(frame, "se", 100, 100, 800, 600, 1).width).toBe(40);
  });

  it("clamps frames back inside the image", () => {
    expect(clampCropFrame({ x: -50, y: 500, width: 300 }, 800, 600, 1)).toEqual(
      { x: 0, y: 300, width: 300 },
    );
    expect(clampCropFrame({ x: 0, y: 0, width: 900 }, 800, 600, 4)).toEqual({
      x: 0,
      y: 0,
      width: 800,
    });
  });
});
