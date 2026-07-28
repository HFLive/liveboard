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
  minio: {
    endpoint: "minio:9000",
    bucket: "liveboard-assets",
  },
  oss: {
    region: "cn-hangzhou",
    bucket: "liveboard",
    endpoint: null,
    internal: false,
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

  it("keeps internal endpoints and direct downloads mutually exclusive", async () => {
    render(<StorageBackendClient />);

    const internalEndpoint = await screen.findByRole("checkbox", {
      name: "服务器与 OSS 同地域，使用内网 Endpoint（免流量费）",
    });
    const directDownload = screen.getByRole("button", { name: "签名直出" });

    expect(internalEndpoint).toBeEnabled();
    expect(directDownload).toBeEnabled();

    fireEvent.click(internalEndpoint);
    expect(internalEndpoint).toBeChecked();
    expect(directDownload).toBeDisabled();

    fireEvent.click(internalEndpoint);
    fireEvent.click(directDownload);
    expect(directDownload).toHaveClass("active");
    expect(internalEndpoint).toBeDisabled();
    expect(
      screen.getByText(
        "签名直出需要浏览器访问公网 Endpoint，不能使用内网 Endpoint。",
      ),
    ).toBeInTheDocument();
  });
});
