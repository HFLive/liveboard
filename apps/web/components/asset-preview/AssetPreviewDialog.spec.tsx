import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AssetPreviewDialog } from "./AssetPreviewDialog";

const textAsset = {
  id: "asset-1",
  filename: "list.txt",
  mimeType: "text/plain",
  sizeBytes: 282,
};

describe("AssetPreviewDialog", () => {
  it("shows one filename and a compact download fallback", () => {
    render(<AssetPreviewDialog asset={textAsset} onClose={vi.fn()} />);

    expect(screen.getAllByText("list.txt")).toHaveLength(1);
    expect(screen.getByText("无法在线预览")).toBeInTheDocument();
    expect(screen.getByText("下载后可使用本地应用打开。")).toBeInTheDocument();
    expect(screen.getByText(/282 B/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "下载" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^关闭$/ }),
    ).not.toBeInTheDocument();
  });

  it("closes from the icon and Escape key", () => {
    const onClose = vi.fn();
    render(<AssetPreviewDialog asset={textAsset} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "关闭文件预览" }));
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
