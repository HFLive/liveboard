import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { askAiStream, getAiStatus, listAiConversations } from "@/lib/api";
import { AiAssistantClient } from "./AiAssistantClient";

vi.mock("@/lib/api", () => ({
  askAiStream: vi.fn(),
  deleteAiConversation: vi.fn(),
  getAiConversation: vi.fn(),
  getAiStatus: vi.fn(),
  listAiConversations: vi.fn(),
}));

describe("AiAssistantClient keyboard input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAiStatus).mockResolvedValue({
      status: {
        available: true,
        configured: true,
        enabled: true,
        reason: null,
      },
    });
    vi.mocked(listAiConversations).mockResolvedValue({ conversations: [] });
    vi.mocked(askAiStream).mockResolvedValue(undefined);
  });

  it("sends the question when Enter is pressed", async () => {
    render(<AiAssistantClient />);
    const input = await screen.findByPlaceholderText("询问资料中的专业问题...");

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "测试默认发送" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(askAiStream).toHaveBeenCalledOnce();
      expect(input).toHaveValue("");
    });
    expect(screen.getByText("测试默认发送")).toBeInTheDocument();
  });

  it("keeps editing when Shift and Enter are pressed together", async () => {
    render(<AiAssistantClient />);
    const input = await screen.findByPlaceholderText("询问资料中的专业问题...");

    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "第一行" } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    fireEvent.change(input, { target: { value: "第一行\n第二行" } });

    expect(askAiStream).not.toHaveBeenCalled();
    expect(input).toHaveValue("第一行\n第二行");
  });

  it("shows sources as document links without expandable block details", async () => {
    vi.mocked(askAiStream).mockImplementation(async (_input, handlers) => {
      handlers.onSources?.([
        {
          id: "file-1",
          title: "课程资料",
          type: "doc",
          updatedAt: "2026-07-15T00:00:00.000Z",
          blocks: [
            { id: "block-1", type: "paragraph", text: "不应展开的段落" },
          ],
        },
      ]);
    });

    render(<AiAssistantClient />);
    const input = await screen.findByPlaceholderText("询问资料中的专业问题...");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "引用了哪些资料？" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const sourceLink = await screen.findByRole("link", { name: "课程资料" });
    expect(sourceLink).toHaveAttribute("href", "/app/content/file-1");
    expect(document.querySelector("details")).not.toBeInTheDocument();
    expect(screen.queryByText("不应展开的段落")).not.toBeInTheDocument();
  });

  it("shows an unavailable historical source as non-clickable", async () => {
    vi.mocked(askAiStream).mockImplementation(async (_input, handlers) => {
      handlers.onSources?.([
        {
          id: "file-deleted",
          title: "旧资料",
          type: "doc",
          updatedAt: "2026-07-15T00:00:00.000Z",
          unavailable: true,
        },
      ]);
    });

    render(<AiAssistantClient />);
    const input = await screen.findByPlaceholderText("询问资料中的专业问题...");
    await waitFor(() => expect(input).toBeEnabled());
    fireEvent.change(input, { target: { value: "旧资料在哪里？" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("文件不存在")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "文件不存在" }),
    ).not.toBeInTheDocument();
  });
});
