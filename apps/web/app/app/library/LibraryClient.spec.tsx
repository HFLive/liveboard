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
  deleteLibraryAsset: vi.fn(),
  listLibraryAssets: vi.fn(),
  listAssetReferences: vi.fn(),
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
