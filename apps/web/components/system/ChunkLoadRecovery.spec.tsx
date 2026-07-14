import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  ChunkLoadRecovery,
  isChunkLoadFailure,
  markChunkReload,
} from "./ChunkLoadRecovery";

describe("ChunkLoadRecovery", () => {
  it.each([
    [new Error("ChunkLoadError: Loading chunk 123 failed"), true],
    ["Failed to fetch dynamically imported module", true],
    [{ message: "CSS_CHUNK_LOAD_FAILED" }, true],
    [new Error("ordinary request failed"), false],
    [null, false],
  ])("recognizes recoverable chunk failures", (reason, expected) => {
    expect(isChunkLoadFailure(reason)).toBe(expected);
  });

  it("marks each path for at most one automatic reload", () => {
    expect(markChunkReload("/app/content", window.sessionStorage)).toBe(true);
    expect(markChunkReload("/app/content", window.sessionStorage)).toBe(false);
    expect(markChunkReload("/app/forum", window.sessionStorage)).toBe(true);
  });

  it("does not reload when storage is unavailable", () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error("storage disabled");
      }),
      setItem: vi.fn(),
    };

    expect(markChunkReload("/app", storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("registers and removes browser failure listeners", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");

    const view = render(<ChunkLoadRecovery />);

    expect(add).toHaveBeenCalledWith("error", expect.any(Function), true);
    expect(add).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
    view.unmount();
    expect(remove).toHaveBeenCalledWith("error", expect.any(Function), true);
    expect(remove).toHaveBeenCalledWith(
      "unhandledrejection",
      expect.any(Function),
    );
  });
});
