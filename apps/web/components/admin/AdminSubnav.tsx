"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Database,
  LayoutDashboard,
  MessageSquare,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";

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
    href: APP_ROUTES.adminForum,
    label: "论坛",
    icon: MessageSquare,
  },
  {
    href: APP_ROUTES.adminAi,
    label: "AI",
    icon: Bot,
  },
  {
    href: APP_ROUTES.adminSettings,
    label: "系统",
    icon: Settings,
  },
] as const;

export function AdminSubnav() {
  const pathname = usePathname();

  return (
    <nav aria-label="管理中心导航" className="admin-subnav">
      {adminNavItems.map((item) => {
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
