import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useDocumentTitle } from "./useDocumentTitle";

describe("useDocumentTitle", () => {
  it("does not restore a stale title after the next route has updated it", () => {
    document.title = "文档 · LiveBoard";
    const view = renderHook(() => useDocumentTitle("具体文档"));
    expect(document.title).toBe("具体文档 · LiveBoard");

    document.title = "论坛 · LiveBoard";
    view.unmount();

    expect(document.title).toBe("论坛 · LiveBoard");
  });
});
