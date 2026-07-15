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
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";
import { getMe } from "@/lib/api";

const adminNavItems = [
  {
    href: APP_ROUTES.admin,
    label: "总览",
    icon: LayoutDashboard,
  },
  {
    href: APP_ROUTES.adminUsers,
    label: "成员",
    icon: Users,
  },
  {
    href: APP_ROUTES.adminStorage,
    label: "容量",
    icon: Database,
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
  {
    href: APP_ROUTES.adminForum,
    label: "论坛",
    icon: MessageSquare,
  },
  {
    href: APP_ROUTES.adminAi,
    label: "AI",
    icon: Bot,
    superAdminOnly: true,
  },
  {
    href: APP_ROUTES.adminSettings,
    label: "系统",
    icon: Settings,
    superAdminOnly: true,
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

  const visibleItems = adminNavItems.filter(
    (item) => !("superAdminOnly" in item) || role === "super_admin",
  );

  return (
    <nav aria-label="管理中心导航" className="admin-subnav">
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
    </nav>
  );
}
