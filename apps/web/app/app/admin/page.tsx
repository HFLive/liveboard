"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useState } from "react";
import type { SystemRole } from "@liveboard/shared";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  MessageSquare,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { AdminSubnav } from "@/components/admin/AdminSubnav";
import { APP_ROUTES } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { getAiSettings, getMe, listUsers, listUserStorage } from "@/lib/api";

type AdminTask = {
  href: string;
  title: string;
  detail: string;
  level: "warning" | "info";
};

const adminEntries = [
  {
    href: APP_ROUTES.adminUsers,
    title: "成员",
    detail: "创建账号、调整角色与每日 AI 限额",
    icon: Users,
  },
  {
    href: APP_ROUTES.adminStorage,
    title: "容量",
    detail: "查看文件占用并调整个人上限",
    icon: Database,
  },
  {
    href: APP_ROUTES.adminGroups,
    title: "权限组",
    detail: "按教学职责组织成员",
    icon: ShieldCheck,
  },
  {
    href: APP_ROUTES.adminContentPermissions,
    title: "文档权限",
    detail: "设置文档的全局继承起点",
    icon: SlidersHorizontal,
  },
  {
    href: APP_ROUTES.adminForum,
    title: "论坛",
    detail: "维护版块名称、说明与顺序",
    icon: MessageSquare,
  },
  {
    href: APP_ROUTES.adminAi,
    title: "AI",
    detail: "配置模型、回答范围与每日限额",
    icon: Bot,
    superAdminOnly: true,
  },
  {
    href: APP_ROUTES.adminSettings,
    title: "系统",
    detail: "维护全站时区与时间显示",
    icon: Settings,
    superAdminOnly: true,
  },
] as const;

export default function AdminPage() {
  const [role, setRole] = useState<SystemRole | null>(null);
  const [tasks, setTasks] = useState<AdminTask[] | null>(null);

  useDocumentTitle("管理中心");

  useEffect(() => {
    getMe()
      .then(async (result) => {
        setRole(result.user.systemRole);
        const [usersResult, storageResult, aiResult] = await Promise.all([
          listUsers(),
          listUserStorage(),
          result.user.systemRole === "super_admin"
            ? getAiSettings().catch(() => null)
            : Promise.resolve(null),
        ]);
        const nextTasks: AdminTask[] = [];
        const disabledCount = usersResult.users.filter(
          (user) => user.status === "disabled",
        ).length;
        const highStorageCount = storageResult.users.filter(
          (item) =>
            item.storageQuotaBytes === 0 ||
            item.storageUsedBytes / item.storageQuotaBytes >= 0.9,
        ).length;
        if (disabledCount) {
          nextTasks.push({
            href: APP_ROUTES.adminUsers,
            title: `${disabledCount} 个账号处于停用状态`,
            detail: "复核是否需要重新启用或调整成员资料。",
            level: "info",
          });
        }
        if (highStorageCount) {
          nextTasks.push({
            href: APP_ROUTES.adminStorage,
            title: `${highStorageCount} 位成员容量接近上限`,
            detail: "检查占用情况并按需调整个人容量。",
            level: "warning",
          });
        }
        if (
          aiResult &&
          (!aiResult.settings.enabled || !aiResult.settings.activeConfigId)
        ) {
          nextTasks.push({
            href: APP_ROUTES.adminAi,
            title: "AI 助手尚未完整启用",
            detail: "检查全局开关与当前模型配置。",
            level: "info",
          });
        }
        setTasks(nextTasks);
      })
      .catch(() => {
        setRole(null);
        setTasks([]);
      });
  }, []);

  return (
    <div className="workspace admin-workspace admin-overview-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">系统管理</p>
          <h1>管理中心</h1>
          <p className="muted">集中配置成员、权限、存储与平台服务。</p>
        </div>
      </header>

      <AdminSubnav />

      <div className="admin-overview-grid">
        <section className="admin-task-panel">
          <div className="panel-head">
            <div>
              <h2>待处理事项</h2>
              <p className="muted">根据当前账号和系统状态自动汇总。</p>
            </div>
          </div>
          <div className="admin-task-list">
            {tasks?.map((task) => (
              <Link
                className={`admin-task-row ${task.level}`}
                href={task.href as Route}
                key={task.title}
              >
                {task.level === "warning" ? (
                  <AlertTriangle aria-hidden="true" />
                ) : (
                  <Users aria-hidden="true" />
                )}
                <span>
                  <strong>{task.title}</strong>
                  <small>{task.detail}</small>
                </span>
              </Link>
            ))}
            {tasks === null ? (
              <div className="skeleton admin-task-skeleton" />
            ) : null}
            {tasks?.length === 0 ? (
              <div className="admin-task-empty">
                <CheckCircle2 aria-hidden="true" />
                <span>
                  <strong>当前没有待处理事项</strong>
                  <small>成员、容量和全局服务状态正常。</small>
                </span>
              </div>
            ) : null}
          </div>
        </section>
        <section className="admin-entry-panel">
          <div className="panel-head">
            <div>
              <h2>管理入口</h2>
              <p className="muted">按当前账号权限显示可用设置。</p>
            </div>
          </div>
          <div className="admin-entry-grid">
            {adminEntries
              .filter(
                (entry) =>
                  !("superAdminOnly" in entry) || role === "super_admin",
              )
              .map((entry) => {
                const Icon = entry.icon;
                return (
                  <Link
                    className="admin-entry-link"
                    href={entry.href}
                    key={entry.href}
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <strong>{entry.title}</strong>
                      <small>{entry.detail}</small>
                    </span>
                  </Link>
                );
              })}
          </div>
        </section>
      </div>
    </div>
  );
}
