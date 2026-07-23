import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getServerStatus } from "@/lib/api";
import { ServerStatusClient } from "./ServerStatusClient";

vi.mock("@/components/admin/AdminSubnav", () => ({
  AdminSubnav: () => <nav aria-label="管理中心导航" />,
}));

vi.mock("@/lib/useDocumentTitle", () => ({
  useDocumentTitle: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  getServerStatus: vi.fn(),
}));

const status = {
  current: {
    sampledAt: "2026-07-23T14:00:00.000Z",
    cpuUsagePercent: 25.4,
    memory: {
      usagePercent: 51.2,
      usedBytes: 8 * 1024 ** 3,
      totalBytes: 16 * 1024 ** 3,
    },
    disk: {
      usagePercent: 60,
      usedBytes: 60 * 1024 ** 3,
      totalBytes: 100 * 1024 ** 3,
    },
  },
  history: [
    {
      sampledAt: "2026-07-23T13:58:00.000Z",
      cpuUsagePercent: 20,
      memoryUsagePercent: 50,
      diskUsagePercent: 60,
    },
  ],
  sampleIntervalSeconds: 60,
  retentionHours: 168,
};

describe("ServerStatusClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerStatus).mockResolvedValue(status);
  });

  it("shows current resource usage and reloads the selected range", async () => {
    render(<ServerStatusClient />);

    expect(await screen.findByText("25.4%")).toBeInTheDocument();
    expect(screen.getByText("51.2%")).toBeInTheDocument();
    expect(screen.getByText("60.0%")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: "最近 24 小时 CPU、内存和硬盘占用率曲线",
      }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "6 小时" }));

    await waitFor(() => expect(getServerStatus).toHaveBeenLastCalledWith(6));
  });
});
