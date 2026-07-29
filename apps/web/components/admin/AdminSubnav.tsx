"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { SystemRole } from "@liveboard/shared";
import { getMe } from "@/lib/api";
import { adminNavGroups, adminOverviewItem } from "./adminNavigation";

export function AdminSubnav() {
  const pathname = usePathname();
  const [role, setRole] = useState<SystemRole | null>(null);
  const OverviewIcon = adminOverviewItem.icon;

  useEffect(() => {
    getMe()
      .then((result) => setRole(result.user.systemRole))
      .catch(() => setRole(null));
  }, []);

  return (
    <nav aria-label="管理中心导航" className="admin-context-nav">
      <div className="admin-context-head">
        <strong>管理中心</strong>
      </div>
      <Link
        aria-current={pathname === adminOverviewItem.href ? "page" : undefined}
        className={
          pathname === adminOverviewItem.href
            ? "admin-overview-nav active"
            : "admin-overview-nav"
        }
        href={adminOverviewItem.href}
      >
        <OverviewIcon aria-hidden="true" />
        <span>{adminOverviewItem.label}</span>
      </Link>
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
