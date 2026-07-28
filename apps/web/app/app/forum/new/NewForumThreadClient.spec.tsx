import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listForumOverview } from "@/lib/api";
import { NewForumThreadClient } from "./NewForumThreadClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  createForumThread: vi.fn(),
  listForumOverview: vi.fn(),
  uploadForumPostImages: vi.fn(),
}));

describe("NewForumThreadClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listForumOverview).mockResolvedValue({
      categories: [
        {
          id: "category-1",
          name: "课程交流",
          description: "讨论课堂内容",
          sortOrder: 0,
          threadCount: 0,
        },
      ],
      threads: [],
    });
  });

  it("does not offer related-content selection when creating a post", async () => {
    render(<NewForumThreadClient />);

    expect(
      await screen.findByRole("option", { name: "课程交流" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/关联内容/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("论坛发帖")).toBeInTheDocument();
  });
});
