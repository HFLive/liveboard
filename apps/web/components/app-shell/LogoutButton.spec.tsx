import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { logout } from "@/lib/api";
import { LogoutButton } from "./LogoutButton";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/api", () => ({ logout: vi.fn() }));

describe("LogoutButton", () => {
  beforeEach(() => vi.clearAllMocks());

  it("disables itself while logout is pending", async () => {
    let resolveLogout: (() => void) | undefined;
    vi.mocked(logout).mockReturnValue(
      new Promise((resolve) => {
        resolveLogout = () => resolve({ ok: true });
      }),
    );
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    expect(screen.getByRole("button", { name: "正在退出" })).toBeDisabled();
    resolveLogout?.();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
  });

  it("returns to the home page even if the logout request fails", async () => {
    vi.mocked(logout).mockRejectedValue(new Error("network unavailable"));
    render(<LogoutButton />);

    fireEvent.click(screen.getByRole("button", { name: "退出登录" }));

    await waitFor(() => {
      expect(replace).toHaveBeenCalledWith("/");
      expect(refresh).toHaveBeenCalledTimes(1);
    });
  });
});
