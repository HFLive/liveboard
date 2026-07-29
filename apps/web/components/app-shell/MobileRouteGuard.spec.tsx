import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileRouteGuard } from "./MobileRouteGuard";

const navigationState = { pathname: "/app/content/file-1/edit" };

vi.mock("next/navigation", () => ({
  usePathname: () => navigationState.pathname,
}));

describe("MobileRouteGuard", () => {
  beforeEach(() => {
    navigationState.pathname = "/app/content/file-1/edit";
  });

  it.each([
    "/app/content/file-1/edit",
    "/app/teaching/new",
    "/app/teaching/deck-1/edit",
    "/app/exercises/new",
    "/app/exercises/exercise-1/edit",
    "/app/exercises/exercise-1/submissions",
  ])("allows the mobile editing workflow at %s", (pathname) => {
    navigationState.pathname = pathname;

    render(
      <MobileRouteGuard>
        <span>移动端工作区</span>
      </MobileRouteGuard>,
    );

    expect(screen.getByText("移动端工作区")).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the administration center desktop-only", () => {
    navigationState.pathname = "/app/admin";

    render(
      <MobileRouteGuard>
        <span>管理工作区</span>
      </MobileRouteGuard>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(
      "管理中心仅支持电脑端",
    );
  });
});
