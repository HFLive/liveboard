"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import type { SystemRole } from "@liveboard/shared";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import {
  adminNavGroups,
  adminOverviewItem,
} from "@/components/admin/adminNavigation";
import { getMe } from "@/lib/api";
import { useDocumentTitle } from "@/lib/useDocumentTitle";

export function AdminOverviewClient() {
  const [role, setRole] = useState<SystemRole | null>(null);
  useDocumentTitle("管理中心");

  useEffect(() => {
    getMe()
      .then((result) => setRole(result.user.systemRole))
      .catch(() => setRole(null));
  }, []);

  return (
    <div className="workspace admin-workspace admin-page admin-page--standard admin-overview-page">
      <AdminPageHeader
        category="管理中心"
        description="管理成员、内容和系统服务。"
        title="管理总览"
      />

      <div className="admin-overview-groups">
        {adminNavGroups.map((group) => {
          const visibleItems = group.items.filter(
            (item) => !("superAdminOnly" in item) || role === "super_admin",
          );
          if (visibleItems.length === 0) return null;

          return (
            <section className="admin-overview-group" key={group.label}>
              <div className="admin-overview-group-head">
                <h2>{group.label}</h2>
                <p>{group.description}</p>
              </div>
              <div className="admin-overview-links">
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link href={item.href} key={item.href}>
                      <Icon aria-hidden="true" />
                      <span>
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </span>
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <span className="sr-only">{adminOverviewItem.description}</span>
    </div>
  );
}
