import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryClient } from "./LibraryClient";
import { listLibraryAssets } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  deleteLibraryAsset: vi.fn(),
  listLibraryAssets: vi.fn(),
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
  });

  it("starts unselected and clears selection from workspace background", async () => {
    const { container } = render(<LibraryClient />);

    const card = await screen.findByRole("button", { name: /example.png/ });
    expect(card).not.toHaveClass("active");
    expect(screen.getByText("未选择文件")).toBeInTheDocument();

    fireEvent.click(card);
    expect(card).toHaveClass("active");

    const assetGrid = container.querySelector(".asset-grid");
    expect(assetGrid).not.toBeNull();
    fireEvent.click(assetGrid as HTMLElement);

    await waitFor(() => expect(card).not.toHaveClass("active"));
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
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
    expect(screen.getByText("未选择文件")).toBeInTheDocument();
  });
});
