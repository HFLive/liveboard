import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { linkHfliveWithPassword } from "@/lib/api";
import { AccountLinkForm } from "./AccountLinkForm";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/api", () => ({
  linkHfliveWithPassword: vi.fn(),
}));

describe("AccountLinkForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/login/link#ticket=opaque-ticket");
  });

  it("removes the ticket from the address bar and links with explicit local proof", async () => {
    vi.mocked(linkHfliveWithPassword).mockResolvedValue({ user: {} as never });
    render(<AccountLinkForm />);

    const username = await screen.findByLabelText("旧 LiveBoard 登录账号");
    expect(window.location.hash).toBe("");
    fireEvent.change(username, { target: { value: "learner" } });
    fireEvent.change(screen.getByLabelText("旧账号密码"), {
      target: { value: "local-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "确认关联并登录" }));

    await waitFor(() => {
      expect(linkHfliveWithPassword).toHaveBeenCalledWith({
        ticket: "opaque-ticket",
        username: "learner",
        password: "local-password",
      });
      expect(replace).toHaveBeenCalledWith("/app/classrooms");
    });
  });

  it("does not show a proof form without a one-time ticket", async () => {
    window.history.replaceState(null, "", "/login/link");
    render(<AccountLinkForm />);

    expect(
      await screen.findByText("关联请求无效或已过期，请重新发起统一身份登录。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("旧 LiveBoard 登录账号"),
    ).not.toBeInTheDocument();
  });
});
