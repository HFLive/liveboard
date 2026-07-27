import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForWebReady } from "./waitForWebReady";

type MockImage = {
  onerror: (() => void) | null;
  onload: (() => void) | null;
  src: string;
};

describe("waitForWebReady", () => {
  const images: MockImage[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    images.length = 0;
    vi.stubGlobal(
      "Image",
      class {
        onerror: (() => void) | null = null;
        onload: (() => void) | null = null;
        private source = "";

        constructor() {
          images.push(this);
        }

        get src() {
          return this.source;
        }

        set src(value: string) {
          this.source = value;
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries until the HTTPS web asset can be decoded", async () => {
    const readiness = waitForWebReady("https://8.166.143.156/", {
      initialDelayMs: 0,
      minimumWaitMs: 500,
      probeTimeoutMs: 50,
      requiredSuccesses: 2,
      retryIntervalMs: 100,
      timeoutMs: 1_000,
    });

    expect(images).toHaveLength(1);
    expect(images[0]?.src).toMatch(
      /^https:\/\/8\.166\.143\.156\/liveboard-readiness\.svg\?/,
    );
    images[0]?.onerror?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(images).toHaveLength(2);
    images[1]?.onload?.();
    await vi.advanceTimersByTimeAsync(100);
    expect(images).toHaveLength(3);
    images[2]?.onload?.();

    await expect(readiness).resolves.toBe(true);
  });

  it("returns false when the web service never becomes ready", async () => {
    const readiness = waitForWebReady("https://board.example.com", {
      initialDelayMs: 0,
      minimumWaitMs: 0,
      probeTimeoutMs: 50,
      requiredSuccesses: 2,
      retryIntervalMs: 50,
      timeoutMs: 180,
    });

    await vi.advanceTimersByTimeAsync(250);

    await expect(readiness).resolves.toBe(false);
    expect(images.length).toBeGreaterThan(1);
  });
});
