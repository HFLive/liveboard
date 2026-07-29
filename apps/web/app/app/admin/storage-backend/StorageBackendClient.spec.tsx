import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getStorageSettings,
  testStorageConnection,
  updateStorageSettings,
} from "@/lib/api";
import { StorageBackendClient } from "./StorageBackendClient";

vi.mock("@/lib/useDocumentTitle", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getStorageSettings: vi.fn(),
  testStorageConnection: vi.fn(),
  updateStorageSettings: vi.fn(),
}));

const storageSettings = {
  backend: "oss" as const,
  downloadMode: "proxy" as const,
  uploadMode: "relay" as const,
  minio: {
    endpoint: "minio:9000",
    bucket: "liveboard-assets",
  },
  oss: {
    region: "cn-hangzhou",
    bucket: "liveboard",
    endpoint: null,
    internal: false,
    internalEndpoint: null,
    accessKeyId: "ak",
    secretConfigured: true,
  },
  activeBackendHealthy: true,
  fileDistribution: {
    minio: { count: 0, bytes: 0 },
    oss: { count: 1, bytes: 1024 },
  },
  updatedAt: "2026-07-28T00:00:00.000Z",
};

describe("StorageBackendClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getStorageSettings).mockResolvedValue({
      storage: storageSettings,
    });
    vi.mocked(testStorageConnection).mockResolvedValue({ ok: true });
    vi.mocked(updateStorageSettings).mockResolvedValue({
      storage: storageSettings,
    });
  });

  it("allows combining the internal endpoint with direct downloads", async () => {
    render(<StorageBackendClient />);

    const internalToggle = await screen.findByRole("checkbox", {
      name: "使用内网 Endpoint",
    });
    const directDownload = screen.getByRole("button", { name: "签名直出" });

    expect(internalToggle).toBeEnabled();
    expect(directDownload).toBeEnabled();

    fireEvent.click(internalToggle);
    expect(internalToggle).toBeChecked();
    expect(directDownload).toBeEnabled();

    fireEvent.click(directDownload);
    expect(directDownload).toHaveClass("active");
    expect(internalToggle).toBeEnabled();
    expect(internalToggle).toBeChecked();
  });

  it("reveals an optional custom internal endpoint field when enabled", async () => {
    render(<StorageBackendClient />);

    const internalToggle = await screen.findByRole("checkbox", {
      name: "使用内网 Endpoint",
    });
    expect(
      screen.queryByRole("textbox", { name: "自定义内网 Endpoint（可选）" }),
    ).not.toBeInTheDocument();

    fireEvent.click(internalToggle);

    const input = screen.getByRole("textbox", {
      name: "自定义内网 Endpoint（可选）",
    });
    expect(input).toHaveAttribute(
      "placeholder",
      "留空使用 s3.oss-cn-hangzhou-internal.aliyuncs.com",
    );

    fireEvent.change(input, { target: { value: "oss-vpc.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));

    expect(updateStorageSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        oss: expect.objectContaining({
          internal: true,
          internalEndpoint: "oss-vpc.example.com",
        }),
      }),
    );
  });

  it("shows a CORS hint when presigned direct upload is selected", async () => {
    render(<StorageBackendClient />);

    const directUpload = await screen.findByRole("button", {
      name: "签名直入",
    });
    expect(screen.queryByText(/需配置 Bucket CORS/)).not.toBeInTheDocument();

    fireEvent.click(directUpload);

    expect(directUpload).toHaveClass("active");
    expect(screen.getByText(/需配置 Bucket CORS/)).toBeInTheDocument();
  });
});
