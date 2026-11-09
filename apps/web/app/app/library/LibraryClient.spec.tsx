import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryClient } from "./LibraryClient";
import {
  AssetInUseError,
  deleteLibraryAsset,
  listLibraryAssets,
  listAssetReferences,
  renameAsset,
} from "@/lib/api";

vi.mock("@/lib/api", () => ({
  AssetInUseError: class AssetInUseError extends Error {
    constructor(
      message: string,
      readonly references: unknown[],
    ) {
      super(message);
    }
  },
  assetDownloadUrl: vi.fn((assetId: string) => `/assets/${assetId}?download=1`),
  deleteLibraryAsset: vi.fn(),
  listLibraryAssets: vi.fn(),
  listAssetReferences: vi.fn(),
  renameAsset: vi.fn(),
  resolveBlockAssetUrl: vi.fn((url: string) => url),
  uploadAsset: vi.fn(),
}));

const asset = {
  id: "asset-1",
  filename: "example.png",
  mimeType: "image/png",
  sizeBytes: 1024,
  createdAt: "2026-07-15T12:00:00.000Z",
  referenceCount: 0,
  folderId: null,
  fileId: null,
  url: "http://localhost:4000/assets/asset-1",
};

describe("LibraryClient selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: false }),
    });
    vi.mocked(listLibraryAssets).mockResolvedValue({ assets: [asset] });
    vi.mocked(listAssetReferences).mockResolvedValue({ references: [] });
  });

  it("links the file page back to documents", () => {
    render(<LibraryClient />);

    expect(screen.getByRole("link", { name: "返回文档" })).toHaveAttribute(
      "href",
      "/app/content",
    );
  });

  it("starts unselected and clears selection from workspace background", async () => {
    const { container } = render(<LibraryClient />);

    const card = await screen.findByRole("button", { name: /example.png/ });
    expect(card).not.toHaveClass("active");
    expect(container.querySelector(".asset-detail-panel")).toBeNull();

    fireEvent.click(card);
    expect(card).toHaveClass("active");
    expect(container.querySelector(".library-layout")).not.toHaveClass(
      "has-detail",
    );
    expect(screen.getByRole("dialog", { name: "example.png" })).toBeVisible();

    const assetGrid = container.querySelector(".asset-grid");
    expect(assetGrid).not.toBeNull();
    fireEvent.click(assetGrid as HTMLElement);

    await waitFor(() => expect(card).not.toHaveClass("active"));
    expect(container.querySelector(".asset-detail-panel")).toBeNull();
  });

  it("clears selection when the mobile detail backdrop is clicked", async () => {
    const { container } = render(<LibraryClient />);

    const card = await screen.findByRole("button", { name: /example.png/ });
    fireEvent.click(card);
    expect(card).toHaveClass("active");

    const backdrop = container.querySelector(".asset-detail-backdrop");
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop as HTMLElement);

    await waitFor(() => expect(card).not.toHaveClass("active"));
    expect(container.querySelector(".asset-detail-panel")).toBeNull();
  });

  it("uses only the header close button in the reference dialog", async () => {
    vi.mocked(listAssetReferences).mockResolvedValue({
      references: [
        {
          targetType: "file",
          fileId: "file-1",
          fileTitle: "课程概述",
          blockId: "block-1",
          blockType: "image",
        },
      ],
    });
    const { container } = render(<LibraryClient />);

    const card = await screen.findByRole("button", { name: /example.png/ });
    fireEvent.click(card);
    const detailPanel = container.querySelector(".asset-detail-panel");
    expect(detailPanel).not.toBeNull();
    fireEvent.click(
      within(detailPanel as HTMLElement).getByRole("button", {
        name: "查看引用来源",
      }),
    );

    const referenceDialog = await screen.findByRole("dialog", {
      name: "引用来源",
    });
    expect(
      within(referenceDialog).getAllByRole("button", { name: "关闭" }),
    ).toHaveLength(1);
  });

  it("keeps the image name editable after a conflict and shows the saved name", async () => {
    const filename = "课程封面.png";
    vi.mocked(renameAsset)
      .mockRejectedValueOnce(new Error("当前文档中已存在同名附件"))
      .mockResolvedValueOnce({
        asset: { id: asset.id, filename, updatedAt: asset.createdAt },
      });
    render(<LibraryClient />);

    fireEvent.click(await screen.findByRole("button", { name: /example.png/ }));
    fireEvent.click(screen.getByText("文件操作"));
    fireEvent.click(screen.getByRole("button", { name: "重命名图片" }));
    const dialog = screen.getByRole("dialog", { name: "重命名图片" });
    const input = within(dialog).getByRole("textbox", { name: "图片名称" });
    const save = within(dialog).getByRole("button", { name: "保存名称" });
    expect(input).toHaveValue(asset.filename);

    fireEvent.change(input, { target: { value: "同名.png" } });
    fireEvent.click(save);
    expect(await screen.findByText("当前文档中已存在同名附件")).toBeVisible();
    expect(input).toHaveValue("同名.png");

    fireEvent.change(input, { target: { value: `  ${filename}  ` } });
    fireEvent.click(save);
    const detail = await screen.findByRole("dialog", { name: filename });
    expect(within(detail).getByRole("img", { name: filename })).toHaveAttribute(
      "src",
      asset.url,
    );
    expect(renameAsset).toHaveBeenLastCalledWith(asset.id, filename);
    expect(dialog).not.toBeInTheDocument();
  });

  it("replaces the delete confirmation with a reference details dialog", async () => {
    vi.mocked(deleteLibraryAsset).mockRejectedValue(
      new AssetInUseError("文件已被引用，不能删除", [
        {
          targetType: "file",
          fileId: "file-1",
          fileTitle: "课程概述",
          blockId: "block-1",
          blockType: "image",
        },
        {
          targetType: "teaching_deck",
          deckId: "deck-1",
          deckTitle: "课堂讲解",
          itemId: "item-1",
        },
      ]),
    );
    const { container } = render(<LibraryClient />);

    const card = await screen.findByRole("button", { name: /example.png/ });
    fireEvent.click(card);
    const detailPanel = container.querySelector(".asset-detail-panel");
    expect(detailPanel).not.toBeNull();
    fireEvent.click(
      within(detailPanel as HTMLElement).getByRole("button", { name: "删除" }),
    );

    const confirmation = screen
      .getByRole("heading", { name: "删除文件" })
      .closest(".modal-panel");
    expect(confirmation).not.toBeNull();
    fireEvent.click(
      within(confirmation as HTMLElement).getByRole("button", {
        name: "删除",
      }),
    );

    const blockedDialog = await screen.findByRole("dialog", {
      name: "文件无法删除",
    });
    expect(
      screen.queryByRole("heading", { name: "删除文件" }),
    ).not.toBeInTheDocument();
    expect(within(blockedDialog).getByText("课程概述")).toBeInTheDocument();
    expect(within(blockedDialog).getByText("课堂讲解")).toBeInTheDocument();
    expect(container.querySelector(".reference-warning")).toBeNull();
  });
});
