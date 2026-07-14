import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { login } from "@/lib/api";
import { LoginForm } from "./LoginForm";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/api", () => ({
  login: vi.fn(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs in and opens the AI workspace", async () => {
    vi.mocked(login).mockResolvedValue({ user: {} as never });
    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "teacher" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith("teacher", "secret-password");
      expect(replace).toHaveBeenCalledWith("/app/ai");
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  it("shows a rejected login without navigating", async () => {
    vi.mocked(login).mockRejectedValue(new Error("账号或密码错误"));
    render(<LoginForm />);

    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByText("账号或密码错误")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
