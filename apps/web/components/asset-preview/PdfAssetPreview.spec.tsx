import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePdfPreviewUrl } from "@/lib/api";
import { PdfAssetPreview } from "./PdfAssetPreview";

vi.mock("@/lib/api", () => ({
  resolvePdfPreviewUrl: vi.fn(),
}));

const resolveUrl = vi.mocked(resolvePdfPreviewUrl);
const props = { previewPath: "/assets/asset-1/preview" };

describe("PdfAssetPreview", () => {
  beforeEach(() => {
    resolveUrl.mockReset();
  });

  it("offers an explicit new-window link without embedding or navigating automatically", async () => {
    resolveUrl.mockResolvedValue("https://r2.example/signed.pdf");
    const openWindow = vi.spyOn(window, "open");
    const { container } = render(<PdfAssetPreview {...props} />);

    expect(screen.getByRole("status")).toHaveTextContent("正在准备文件");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    const openLink = await screen.findByRole("link", { name: "新窗口打开" });
    expect(openLink).toHaveAttribute("href", "https://r2.example/signed.pdf");
    expect(openLink).toHaveAttribute("target", "_blank");
    expect(openLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(openLink).not.toHaveAttribute("download");
    expect(container.querySelector("iframe, embed, object, canvas")).toBeNull();
    expect(screen.queryByLabelText("跳转到页码")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(openWindow).not.toHaveBeenCalled();
    openWindow.mockRestore();
  });

  it("uses the classroom preview endpoint returned by the API helper", async () => {
    const path = "/classrooms/c1/files/f1/preview";
    resolveUrl.mockResolvedValue(path);
    render(<PdfAssetPreview {...props} previewPath={path} />);

    expect(
      await screen.findByRole("link", { name: "新窗口打开" }),
    ).toHaveAttribute("href", path);
    expect(resolveUrl).toHaveBeenCalledWith(path, expect.any(AbortSignal));
  });

  it("surfaces permission errors without creating a viewer or an open link", async () => {
    resolveUrl.mockRejectedValue(new Error("无权查看这个文件"));
    const { container } = render(<PdfAssetPreview {...props} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "无权查看这个文件",
    );
    expect(container.querySelector("iframe")).toBeNull();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("aborts pending work and ignores a late URL after changing files", async () => {
    let finishFirst!: (url: string) => void;
    resolveUrl
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValueOnce("/assets/asset-2/preview");
    const { rerender } = render(<PdfAssetPreview {...props} />);
    const firstSignal = resolveUrl.mock.calls[0]![1];

    rerender(
      <PdfAssetPreview {...props} previewPath="/assets/asset-2/preview" />,
    );
    expect(firstSignal.aborted).toBe(true);
    await screen.findByRole("link", { name: "新窗口打开" });
    await act(async () => {
      finishFirst("https://r2.example/stale.pdf");
    });
    expect(screen.getByRole("link", { name: "新窗口打开" })).toHaveAttribute(
      "href",
      "/assets/asset-2/preview",
    );
  });

  it("aborts the pending URL request when the dialog closes", () => {
    resolveUrl.mockImplementation(() => new Promise(() => {}));
    const { unmount } = render(<PdfAssetPreview {...props} />);
    const signal = resolveUrl.mock.calls[0]![1];

    unmount();

    expect(signal.aborted).toBe(true);
  });
});
