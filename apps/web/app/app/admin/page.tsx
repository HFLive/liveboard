"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { SystemRole } from "@liveboard/shared";
import {
  Bot,
  Database,
  MessageSquare,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { AdminSubnav } from "@/components/admin/AdminSubnav";
import { APP_ROUTES } from "@/lib/routes";
import { getMe } from "@/lib/api";

export default function AdminPage() {
  const [role, setRole] = useState<SystemRole | null>(null);

  useEffect(() => {
    getMe()
      .then((result) => setRole(result.user.systemRole))
      .catch(() => setRole(null));
  }, []);

  return (
    <div className="workspace">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">系统管理</p>
          <h1>管理中心</h1>
          <p className="muted">集中配置成员、权限、存储与平台服务。</p>
        </div>
      </header>

      <AdminSubnav />

      <section className="admin-hub-grid">
        <Link className="admin-hub-card" href={APP_ROUTES.adminUsers}>
          <Users aria-hidden="true" />
          <span>
            <strong>成员管理</strong>
            <small>创建账号、导入成员和调整权限</small>
          </span>
        </Link>
        <Link className="admin-hub-card" href={APP_ROUTES.adminStorage}>
          <Database aria-hidden="true" />
          <span>
            <strong>容量管理</strong>
            <small>查看使用量并调整成员上限</small>
          </span>
        </Link>
        <Link className="admin-hub-card" href={APP_ROUTES.adminGroups}>
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>权限组</strong>
            <small>维护成员分组和资料授权</small>
          </span>
        </Link>
        <Link
          className="admin-hub-card"
          href={APP_ROUTES.adminContentPermissions}
        >
          <SlidersHorizontal aria-hidden="true" />
          <span>
            <strong>内容默认权限</strong>
            <small>设置顶层文件夹继承的基础权限</small>
          </span>
        </Link>
        <Link className="admin-hub-card" href={APP_ROUTES.adminForum}>
          <MessageSquare aria-hidden="true" />
          <span>
            <strong>论坛设置</strong>
            <small>维护论坛版块和显示顺序</small>
          </span>
        </Link>
        {role === "super_admin" ? (
          <>
            <Link className="admin-hub-card" href={APP_ROUTES.adminAi}>
              <Bot aria-hidden="true" />
              <span>
                <strong>AI 设置</strong>
                <small>配置模型服务和回答范围</small>
              </span>
            </Link>
            <Link className="admin-hub-card" href={APP_ROUTES.adminSettings}>
              <Settings aria-hidden="true" />
              <span>
                <strong>系统设置</strong>
                <small>设置时区和全站显示</small>
              </span>
            </Link>
          </>
        ) : null}
      </section>
    </div>
  );
}
