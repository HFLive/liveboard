import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiRetrievalPanel } from "./AiRetrievalPanel";
import {
  getAiRetrievalSettings,
  updateAiRetrievalSettings,
  syncAiRetrieval,
} from "@/lib/api";

vi.mock("@/lib/api", () => ({
  getAiRetrievalSettings: vi.fn(),
  updateAiRetrievalSettings: vi.fn(),
  syncAiRetrieval: vi.fn(),
}));

const settings = {
  enabled: false,
  providerName: "custom",
  baseUrl: "",
  model: "",
  dimensions: 0,
  apiKeyConfigured: false,
  totalDocuments: 3,
  indexedDocuments: 0,
  pendingDocuments: 3,
  failedDocuments: 0,
  indexedChunks: 0,
  indexing: false,
  lastError: null,
};

describe("AI retrieval settings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getAiRetrievalSettings).mockResolvedValue({
      retrieval: settings,
    });
    vi.mocked(syncAiRetrieval).mockResolvedValue({ scheduled: true });
  });
  afterEach(cleanup);

  it("shows the actual unconfigured state and an independent embedding form", async () => {
    render(<AiRetrievalPanel />);
    await screen.findByText("尚未开启，当前使用关键词检索");
    fireEvent.click(screen.getByRole("button", { name: "配置向量模型" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Embedding 模型 ID")).toHaveValue("");
    expect(screen.getByLabelText("API Key")).toHaveValue("");
  });

  it("requires a new key when the endpoint changes", async () => {
    vi.mocked(getAiRetrievalSettings).mockResolvedValue({
      retrieval: {
        ...settings,
        enabled: true,
        baseUrl: "https://api.openai.com/v1",
        model: "test-embedding",
        dimensions: 3,
        apiKeyConfigured: true,
      },
    });
    render(<AiRetrievalPanel />);
    await screen.findByText("test-embedding · 3 维");
    fireEvent.click(screen.getByRole("button", { name: "配置向量模型" }));
    expect(screen.getByLabelText("API Key")).not.toBeRequired();
    fireEvent.change(screen.getByLabelText("向量服务商"), {
      target: { value: "其他兼容服务" },
    });
    expect(screen.getByLabelText("API Key")).toBeRequired();
    expect(screen.getByLabelText("API Key")).toHaveValue("");
  });

  it("saves the embedding configuration separately from chat settings", async () => {
    vi.mocked(updateAiRetrievalSettings).mockResolvedValue({
      retrieval: {
        ...settings,
        enabled: true,
        model: "example-embedding",
        dimensions: 3,
        apiKeyConfigured: true,
      },
    });
    render(<AiRetrievalPanel />);
    await screen.findByText("尚未开启，当前使用关键词检索");
    fireEvent.click(screen.getByRole("button", { name: "配置向量模型" }));
    fireEvent.click(screen.getByLabelText("开启语义检索"));
    fireEvent.change(screen.getByLabelText("Embedding 模型 ID"), {
      target: { value: "example-embedding" },
    });
    fireEvent.change(screen.getByLabelText("API Key"), {
      target: { value: "new-test-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "验证并保存" }));
    await waitFor(() =>
      expect(updateAiRetrievalSettings).toHaveBeenCalledWith({
        enabled: true,
        providerName: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "example-embedding",
        apiKey: "new-test-key",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
