"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SystemRole } from "@liveboard/shared";
import {
  Bot,
  Database,
  LayoutDashboard,
  MessageSquare,
  MonitorCog,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";
import { getMe } from "@/lib/api";

const adminNavGroups = [
  {
    label: "概览",
    items: [
      {
        href: APP_ROUTES.admin,
        label: "管理总览",
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: "人员与权限",
    items: [
      {
        href: APP_ROUTES.adminUsers,
        label: "成员",
        icon: Users,
      },
      {
        href: APP_ROUTES.adminGroups,
        label: "权限组",
        icon: ShieldCheck,
      },
      {
        href: APP_ROUTES.adminContentPermissions,
        label: "文档权限",
        icon: SlidersHorizontal,
      },
    ],
  },
  {
    label: "内容与资源",
    items: [
      {
        href: APP_ROUTES.adminStorage,
        label: "存储容量",
        icon: Database,
      },
      {
        href: APP_ROUTES.adminForum,
        label: "论坛版块",
        icon: MessageSquare,
      },
    ],
  },
  {
    label: "系统与服务",
    items: [
      {
        href: APP_ROUTES.adminAi,
        label: "AI 服务",
        icon: Bot,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminServerStatus,
        label: "服务器状态",
        icon: MonitorCog,
        superAdminOnly: true,
      },
      {
        href: APP_ROUTES.adminSettings,
        label: "系统设置",
        icon: Settings,
        superAdminOnly: true,
      },
    ],
  },
] as const;

export function AdminSubnav() {
  const pathname = usePathname();
  const [role, setRole] = useState<SystemRole | null>(null);

  useEffect(() => {
    getMe()
      .then((result) => setRole(result.user.systemRole))
      .catch(() => setRole(null));
  }, []);

  return (
    <nav aria-label="管理中心导航" className="admin-context-nav">
      <div className="admin-context-head">
        <strong>管理中心</strong>
        <span>工作区配置与运行状态</span>
      </div>
      {adminNavGroups.map((group) => {
        const visibleItems = group.items.filter(
          (item) => !("superAdminOnly" in item) || role === "super_admin",
        );
        if (visibleItems.length === 0) return null;

        return (
          <section className="admin-nav-group" key={group.label}>
            <h2>{group.label}</h2>
            <div>
              {visibleItems.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href;

                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={active ? "active" : undefined}
                    href={item.href}
                    key={item.href}
                  >
                    <Icon aria-hidden="true" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </nav>
  );
}
