import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getFile,
  getFolderTree,
  listBlocks,
  listLibraryAssets,
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
});
