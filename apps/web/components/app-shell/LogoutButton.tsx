"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { logout } from "@/lib/api";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onLogout() {
    setLoading(true);

    try {
      await logout();
    } finally {
      router.replace("/");
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <button
      aria-label={loading ? "正在退出" : "退出登录"}
      className="nav-button"
      disabled={loading}
      onClick={onLogout}
      title={loading ? "正在退出" : "退出登录"}
      type="button"
    >
      <LogOut aria-hidden="true" className="rail-icon" />
      <span>{loading ? "退出中" : "退出"}</span>
    </button>
  );
}
