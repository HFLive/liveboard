import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserContributionSummary } from "@liveboard/shared";
import { getUserContributions } from "@/lib/api";
import { UserContributionHeatmap } from "./UserContributionHeatmap";

vi.mock("@/lib/api", () => ({
  getUserContributions: vi.fn(),
}));

const summary: UserContributionSummary = {
  range: {
    mode: "last_year",
    year: null,
    from: "2025-08-10",
    to: "2026-08-09",
  },
  total: 7,
  days: [
    { date: "2026-08-08", count: 2 },
    { date: "2026-08-09", count: 5 },
  ],
  categories: [
    { category: "learning", count: 2 },
    { category: "teaching", count: 0 },
    { category: "community", count: 5 },
    { category: "resources", count: 0 },
  ],
  availableYears: [2026, 2025],
  timeZone: "Asia/Shanghai",
};

describe("UserContributionHeatmap", () => {
  beforeEach(() => {
    vi.mocked(getUserContributions).mockResolvedValue(summary);
  });

  it("renders the yearly total, populated days and non-empty categories", async () => {
    render(<UserContributionHeatmap userId="user-1" />);

    expect(
      await screen.findByRole("heading", { name: "过去一年共 7 次贡献" }),
    ).toBeInTheDocument();
    expect(screen.getByText("学习 2")).toBeInTheDocument();
    expect(screen.getByText("论坛 5")).toBeInTheDocument();
    expect(screen.queryByText("教学 0")).not.toBeInTheDocument();
    expect(screen.getByLabelText("2026年8月9日 · 5 次贡献")).toHaveClass(
      "level-3",
    );
  });

  it("requests only the selected year when the selector changes", async () => {
    render(<UserContributionHeatmap userId="user-1" />);
    fireEvent.click(
      await screen.findByLabelText("选择贡献年份，当前为过去 12 个月"),
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "2025 年" }));

    await waitFor(() =>
      expect(getUserContributions).toHaveBeenLastCalledWith("user-1", 2025),
    );
  });
});
