import type { ReactNode } from "react";
import type { Metadata } from "next";
import { AdminSubnav } from "@/components/admin/AdminSubnav";
import "./admin.css";

export const metadata: Metadata = { title: "管理中心" };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell">
      <AdminSubnav />
      <div className="admin-shell-main">{children}</div>
    </div>
  );
}
