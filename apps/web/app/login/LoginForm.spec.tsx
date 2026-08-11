import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  breakglassLogin,
  getAuthCapabilities,
  hfliveLoginUrl,
  login,
} from "@/lib/api";
import { LoginForm } from "./LoginForm";

const replace = vi.fn();
const refresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, refresh }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  breakglassLogin: vi.fn(),
  getAuthCapabilities: vi.fn(),
  hfliveLoginUrl: vi.fn(() => "http://localhost:4000/auth/hflive/start"),
  login: vi.fn(),
}));

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthCapabilities).mockResolvedValue({
      mode: "local",
      localLogin: true,
      hfliveOidc: false,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
  });

  it("logs in and opens the classroom workspace", async () => {
    vi.mocked(login).mockResolvedValue({ user: {} as never });
    render(<LoginForm />);

    fireEvent.change(await screen.findByLabelText("登录账号"), {
      target: { value: "teacher" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "secret-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => {
      expect(login).toHaveBeenCalledWith("teacher", "secret-password");
      expect(replace).toHaveBeenCalledWith("/app/classrooms");
      expect(refresh).toHaveBeenCalledOnce();
    });
  });

  it("shows a rejected login without navigating", async () => {
    vi.mocked(login).mockRejectedValue(new Error("账号或密码错误"));
    render(<LoginForm />);

    fireEvent.click(await screen.findByRole("button", { name: "登录" }));

    expect(await screen.findByText("账号或密码错误")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("toggles password visibility from the full toggle button", async () => {
    render(<LoginForm />);

    const passwordInput = await screen.findByLabelText("密码");
    const toggle = screen.getByRole("button", { name: "显示密码" });

    expect(passwordInput).toHaveAttribute("type", "password");
    fireEvent.click(toggle);
    expect(passwordInput).toHaveAttribute("type", "text");
    expect(toggle).toHaveAccessibleName("隐藏密码");
  });

  it("uses HFLive as the only ordinary entry in hflive_oidc mode", async () => {
    vi.mocked(getAuthCapabilities).mockResolvedValue({
      mode: "hflive_oidc",
      localLogin: false,
      hfliveOidc: true,
      breakglass: false,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });

    render(<LoginForm />);

    const entry = await screen.findByRole("link", {
      name: "使用 HFLive 统一身份登录",
    });
    expect(entry).toHaveAttribute(
      "href",
      "http://localhost:4000/auth/hflive/start",
    );
    expect(hfliveLoginUrl).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("登录账号")).not.toBeInTheDocument();
  });

  it("keeps emergency login collapsed and uses the audited endpoint", async () => {
    vi.mocked(getAuthCapabilities).mockResolvedValue({
      mode: "hflive_oidc",
      localLogin: false,
      hfliveOidc: true,
      breakglass: true,
      issuer: "https://auth.hsfz.live",
      profileUrl: "https://auth.hsfz.live/profile",
    });
    vi.mocked(breakglassLogin).mockResolvedValue({ user: {} as never });
    render(<LoginForm />);

    fireEvent.click(await screen.findByText("紧急管理员入口"));
    fireEvent.change(screen.getByLabelText("登录账号"), {
      target: { value: "admin" },
    });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "emergency-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "紧急登录" }));

    await waitFor(() => {
      expect(breakglassLogin).toHaveBeenCalledWith(
        "admin",
        "emergency-password",
      );
    });
    expect(login).not.toHaveBeenCalled();
  });
});
