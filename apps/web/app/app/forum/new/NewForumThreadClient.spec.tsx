import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createForumThread, listForumOverview } from "@/lib/api";
import { NewForumThreadClient } from "./NewForumThreadClient";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/api", () => ({
  createForumThread: vi.fn(),
  listForumOverview: vi.fn(),
  uploadForumPostImageDirect: vi.fn(),
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
    vi.mocked(createForumThread).mockResolvedValue({
      thread: {
        id: "thread-1",
        posts: [{ id: "post-1" }],
      },
    } as unknown as Awaited<ReturnType<typeof createForumThread>>);
  });

  it("does not offer related-content selection when creating a post", async () => {
    render(<NewForumThreadClient />);

    expect(
      await screen.findByRole("option", { name: "课程交流" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/关联内容/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("论坛发帖")).toBeInTheDocument();
  });

  it("publishes normally with the main button", async () => {
    render(<NewForumThreadClient />);

    await screen.findByRole("option", { name: "课程交流" });
    fireEvent.change(screen.getByLabelText(/标题/), {
      target: { value: "测试标题" },
    });
    fireEvent.change(screen.getByLabelText(/正文/), {
      target: { value: "测试正文" },
    });

    fireEvent.click(screen.getByRole("button", { name: "发布" }));

    await waitFor(() =>
      expect(createForumThread).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "category-1",
          title: "测试标题",
          body: "测试正文",
          isAnonymous: false,
        }),
      ),
    );
  });

  it("publishes anonymously when choosing 匿名发布 from the publish menu", async () => {
    render(<NewForumThreadClient />);

    await screen.findByRole("option", { name: "课程交流" });
    fireEvent.change(screen.getByLabelText(/标题/), {
      target: { value: "匿名测试" },
    });
    fireEvent.change(screen.getByLabelText(/正文/), {
      target: { value: "匿名正文" },
    });

    fireEvent.click(screen.getByRole("button", { name: "更多发布方式" }));
    fireEvent.click(screen.getByRole("button", { name: "匿名发布" }));

    await waitFor(() =>
      expect(createForumThread).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryId: "category-1",
          title: "匿名测试",
          body: "匿名正文",
          isAnonymous: true,
        }),
      ),
    );
  });
});
