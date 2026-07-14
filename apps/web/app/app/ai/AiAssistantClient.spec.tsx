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
});
