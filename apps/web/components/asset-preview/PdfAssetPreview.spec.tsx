import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchPreviewUrl } from "@/lib/api";
import { PdfAssetPreview } from "./PdfAssetPreview";

const { getDocumentMock, fetchPreviewUrlMock, ApiErrorMock } = vi.hoisted(
  () => {
    class ApiError extends Error {
      readonly status: number;
      constructor(message: string, status: number) {
        super(message);
        this.status = status;
      }
    }
    return {
      getDocumentMock: vi.fn(),
      fetchPreviewUrlMock: vi.fn(),
      ApiErrorMock: ApiError,
    };
  },
);

vi.mock("@/lib/api", () => ({
  apiResourceUrl: (path: string) => path,
  fetchPreviewUrl: fetchPreviewUrlMock,
  ApiError: ApiErrorMock,
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: getDocumentMock,
}));

type LoadingTask = {
  promise: Promise<unknown>;
  onProgress?: (progress: { loaded: number; total?: number }) => void;
  destroy: ReturnType<typeof vi.fn>;
};

function makeTask(
  promise: Promise<unknown> = Promise.resolve(null),
): LoadingTask {
  return {
    promise,
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

// 带 numPages 的文档代理，用于交互测试（页码输入框、回车提交）。
function makeDocumentProxy(numPages = 10) {
  return {
    numPages,
    getPage: vi.fn().mockResolvedValue({
      getViewport: vi.fn().mockReturnValue({ width: 800, height: 1000 }),
      render: vi.fn().mockReturnValue({
        promise: Promise.resolve(),
        cancel: vi.fn(),
      }),
    }),
  };
}

describe("PdfAssetPreview", () => {
  beforeEach(() => {
    fetchPreviewUrlMock.mockReset();
    getDocumentMock.mockReset();
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        disconnect() {}
        unobserve() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  it("uses the direct signed URL when the backend presigns", async () => {
    fetchPreviewUrlMock.mockResolvedValue({
      url: "https://r2.example/signed.pdf",
    });
    const task = makeTask();
    getDocumentMock.mockReturnValue(task);

    render(<PdfAssetPreview previewPath="/assets/asset-1/preview" />);

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalled());
    expect(fetchPreviewUrlMock).toHaveBeenCalledWith(
      expect.stringContaining("/assets/asset-1/preview-url"),
      expect.anything(),
    );
    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://r2.example/signed.pdf",
        withCredentials: false,
        disableStream: true,
        disableAutoFetch: true,
      }),
    );
    await waitFor(() => expect(task.onProgress).toEqual(expect.any(Function)));
  });

  it("falls back to the proxy endpoint when no direct URL is available", async () => {
    fetchPreviewUrlMock.mockResolvedValue({ url: null });
    getDocumentMock.mockReturnValue(makeTask());

    render(<PdfAssetPreview previewPath="/classrooms/c1/files/f1/preview" />);

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalled());
    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/classrooms/c1/files/f1/preview",
        withCredentials: true,
      }),
    );
  });

  it("falls back to the proxy when the direct URL load fails", async () => {
    fetchPreviewUrlMock.mockResolvedValue({
      url: "https://r2.example/signed.pdf",
    });
    getDocumentMock
      .mockImplementationOnce(() =>
        makeTask(Promise.reject(new TypeError("Failed to fetch"))),
      )
      .mockImplementationOnce(() => makeTask());

    render(<PdfAssetPreview previewPath="/assets/asset-1/preview" />);

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalledTimes(2));
    expect(getDocumentMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        url: "/assets/asset-1/preview",
        withCredentials: true,
      }),
    );
  });

  it("falls back to the proxy when the preview-url probe fails", async () => {
    fetchPreviewUrlMock.mockRejectedValue(new Error("server error"));
    getDocumentMock.mockReturnValue(makeTask());

    render(<PdfAssetPreview previewPath="/assets/asset-1/preview" />);

    await waitFor(() => expect(getDocumentMock).toHaveBeenCalled());
    expect(getDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/assets/asset-1/preview",
        withCredentials: true,
      }),
    );
  });

  it("surfaces a 403 from the preview-url probe without attempting the proxy", async () => {
    fetchPreviewUrlMock.mockRejectedValue(
      new ApiErrorMock("No permission to view asset", 403),
    );
    getDocumentMock.mockReturnValue(makeTask());

    render(<PdfAssetPreview previewPath="/assets/asset-1/preview" />);

    expect(await screen.findByText("无法在线预览")).toBeInTheDocument();
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it("commits a page on Enter and keeps it across blur, discarding uncommitted input", async () => {
    fetchPreviewUrlMock.mockResolvedValue({ url: null });
    getDocumentMock.mockReturnValue(
      makeTask(Promise.resolve(makeDocumentProxy())),
    );

    render(<PdfAssetPreview previewPath="/assets/asset-1/preview" />);

    const input = await screen.findByLabelText("跳转到页码");
    await waitFor(() => expect(input).not.toBeDisabled());

    // 输入 9 后回车：提交并跳转到第 9 页，输入框保持 9（不被 blur 闪回旧页）。
    fireEvent.change(input, { target: { value: "9" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue(9);

    // 未提交的输入（改 5 后直接 blur）应被丢弃，回到当前页 9。
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.blur(input);
    expect(input).toHaveValue(9);
  });
});
