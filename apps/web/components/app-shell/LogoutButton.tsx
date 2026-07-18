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
    } catch {
      // The local session is discarded by navigation even if the API is offline.
    } finally {
      router.replace("/");
      router.refresh();
      setLoading(false);
    }
  }

  return (
    <button
      aria-label={loading ? "正在退出" : "退出登录"}
      className="nav-button rail-logout-button"
      disabled={loading}
      onClick={onLogout}
      type="button"
    >
      <LogOut aria-hidden="true" className="rail-icon" />
    </button>
  );
}
