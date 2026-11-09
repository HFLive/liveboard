import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFile,
  getFolderTree,
  listBlocks,
  listLibraryAssets,
  renameAsset,
} from "@/lib/api";
import { FileEditor } from "./FileEditor";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getFile: vi.fn(),
  getFolderTree: vi.fn(),
  listBlocks: vi.fn(),
  listLibraryAssets: vi.fn(),
  renameAsset: vi.fn(),
}));

describe("FileEditor navigation", () => {
  beforeEach(() => {
    vi.mocked(getFile).mockResolvedValue({
      file: {
        id: "file-1",
        folderId: "folder-1",
        title: "课程导读",
        type: "doc",
        status: "draft",
        pinnedOrder: null,
        updatedAt: "2026-08-24T00:00:00.000Z",
        permission: "owner",
        version: 1,
      },
    });
    vi.mocked(getFolderTree).mockResolvedValue({
      folders: [],
      canManagePins: false,
    });
    vi.mocked(listBlocks).mockResolvedValue({ blocks: [] });
    vi.mocked(listLibraryAssets).mockResolvedValue({ assets: [] });
  });

  it("links back to the current document", () => {
    render(<FileEditor fileId="file-1" />);

    expect(screen.getByRole("link", { name: "返回文档" })).toHaveAttribute(
      "href",
      "/app/content/file-1",
    );
  });

  it("renames the uploaded image from its block menu", async () => {
    const asset = {
      id: "image-1",
      fileId: "file-1",
      folderId: "folder-1",
      filename: "upload.webp",
      mimeType: "image/webp",
      sizeBytes: 100,
      url: "/assets/image-1",
    };
    vi.mocked(listLibraryAssets).mockResolvedValue({ assets: [asset] });
    vi.mocked(listBlocks).mockResolvedValue({
      blocks: [
        {
          id: "block-1",
          fileId: asset.fileId,
          type: "image",
          sortOrder: 0,
          dataJson: { assetId: asset.id, text: "图片说明", url: asset.url },
        },
      ],
    });
    vi.mocked(renameAsset).mockResolvedValue({
      asset: {
        id: asset.id,
        filename: "封面.webp",
        updatedAt: "2026-11-09T00:00:00.000Z",
      },
    });
    render(<FileEditor fileId={asset.fileId} />);

    fireEvent.click(await screen.findByTitle("内容块操作"));
    fireEvent.click(screen.getByRole("button", { name: "重命名图片" }));
    const dialog = screen.getByRole("dialog", { name: "重命名图片" });
    const input = within(dialog).getByRole("textbox", { name: "图片名称" });
    expect(input).toHaveValue(asset.filename);
    fireEvent.change(input, { target: { value: "封面.webp" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存名称" }));

    expect(await screen.findByText("图片已重命名")).toBeVisible();
    expect(renameAsset).toHaveBeenCalledWith(asset.id, "封面.webp");
    expect(screen.getByRole("img", { name: "图片说明" })).toBeVisible();
    fireEvent.click(screen.getByTitle("内容块操作"));
    fireEvent.click(screen.getByRole("button", { name: "重命名图片" }));
    expect(screen.getByRole("textbox", { name: "图片名称" })).toHaveValue(
      "封面.webp",
    );
  });
});
