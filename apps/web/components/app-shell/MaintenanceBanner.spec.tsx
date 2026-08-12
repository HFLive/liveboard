import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMaintenanceStatus } from "@/lib/api";
import { MaintenanceBanner } from "./MaintenanceBanner";

vi.mock("@/lib/api", () => ({
  getMaintenanceStatus: vi.fn(),
}));

const mockedGetMaintenanceStatus = vi.mocked(getMaintenanceStatus);

describe("MaintenanceBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("stays hidden while the status loads successfully and maintenance is off", async () => {
    mockedGetMaintenanceStatus.mockResolvedValue({
      enabled: false,
      reason: null,
    });

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows the maintenance warning when the API reports maintenance on", async () => {
    mockedGetMaintenanceStatus.mockResolvedValue({
      enabled: true,
      reason: "迁移数据",
    });

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "系统维护中，站点暂时只读",
    );
    expect(screen.getByRole("status")).toHaveTextContent("迁移数据");
  });

  it("does not alarm on a single transient failure recovered by the quick retry", async () => {
    mockedGetMaintenanceStatus
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValue({ enabled: false, reason: null });

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(mockedGetMaintenanceStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("warns only after consecutive failures while the device is online", async () => {
    mockedGetMaintenanceStatus.mockRejectedValue(
      new TypeError("Network request failed"),
    );

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // 首次失败
      await vi.advanceTimersByTimeAsync(1500); // 快速重试再次失败
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "无法获取维护状态，请稍后重试",
    );
  });

  it("stays silent while the device is offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    mockedGetMaintenanceStatus.mockRejectedValue(
      new TypeError("Network request failed"),
    );

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("recovers immediately when the page is restored from bfcache", async () => {
    mockedGetMaintenanceStatus
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValue({ enabled: false, reason: null });

    render(<MaintenanceBanner />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0); // 首次失败（恢复前在途请求）
    });

    // 页面从 bfcache 恢复：恢复前在途请求失败，随后 pageshow 立即重拉。
    act(() => {
      window.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
