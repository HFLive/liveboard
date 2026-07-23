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
  MonitorCog,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { APP_ROUTES } from "@/lib/routes";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { getAiSettings, getMe, listUsers, listUserStorage } from "@/lib/api";

type AdminTask = {
  href: string;
  title: string;
  detail: string;
  level: "warning" | "info";
};

type AdminSummary = {
  memberCount: number | null;
  disabledCount: number | null;
  storageUsedBytes: number | null;
  storageQuotaBytes: number | null;
  aiReady: boolean | null;
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
    title: "存储容量",
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
    title: "论坛版块",
    detail: "维护版块名称、说明与顺序",
    icon: MessageSquare,
  },
  {
    href: APP_ROUTES.adminAi,
    title: "AI 服务",
    detail: "配置模型、回答范围与每日限额",
    icon: Bot,
    superAdminOnly: true,
  },
  {
    href: APP_ROUTES.adminServerStatus,
    title: "服务器状态",
    detail: "查看 CPU、内存与硬盘占用趋势",
    icon: MonitorCog,
    superAdminOnly: true,
  },
  {
    href: APP_ROUTES.adminSettings,
    title: "系统",
    detail: "维护网站时区和标签页图标",
    icon: Settings,
    superAdminOnly: true,
  },
] as const;

export default function AdminPage() {
  const [role, setRole] = useState<SystemRole | null>(null);
  const [memberTask, setMemberTask] = useState<AdminTask | null>(null);
  const [storageTask, setStorageTask] = useState<AdminTask | null>(null);
  const [aiTask, setAiTask] = useState<AdminTask | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [loadingStorage, setLoadingStorage] = useState(true);
  const [loadingAi, setLoadingAi] = useState(true);
  const [summary, setSummary] = useState<AdminSummary>({
    memberCount: null,
    disabledCount: null,
    storageUsedBytes: null,
    storageQuotaBytes: null,
    aiReady: null,
  });
  const tasks = [memberTask, storageTask, aiTask].filter(
    (task): task is AdminTask => task !== null,
  );
  const tasksLoading =
    loadingMembers ||
    loadingStorage ||
    role === null ||
    (role === "super_admin" && loadingAi);

  useDocumentTitle("管理中心");

  useEffect(() => {
    let active = true;

    listUsers()
      .then((usersResult) => {
        if (!active) return;
        const disabledCount = usersResult.users.filter(
          (user) => user.status === "disabled",
        ).length;
        setSummary((current) => ({
          ...current,
          memberCount: usersResult.users.length,
          disabledCount,
        }));
        setMemberTask(
          disabledCount
            ? {
                href: APP_ROUTES.adminUsers,
                title: `${disabledCount} 个账号处于停用状态`,
                detail: "复核是否需要重新启用或调整成员资料。",
                level: "info",
              }
            : null,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingMembers(false);
      });

    listUserStorage()
      .then((storageResult) => {
        if (!active) return;
        const highStorageCount = storageResult.users.filter(
          (item) =>
            item.storageQuotaBytes === 0 ||
            item.storageUsedBytes / item.storageQuotaBytes >= 0.9,
        ).length;
        setSummary((current) => ({
          ...current,
          storageUsedBytes: storageResult.users.reduce(
            (total, item) => total + item.storageUsedBytes,
            0,
          ),
          storageQuotaBytes: storageResult.users.reduce(
            (total, item) => total + item.storageQuotaBytes,
            0,
          ),
        }));
        setStorageTask(
          highStorageCount
            ? {
                href: APP_ROUTES.adminStorage,
                title: `${highStorageCount} 位成员容量接近上限`,
                detail: "检查占用情况并按需调整个人容量。",
                level: "warning",
              }
            : null,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoadingStorage(false);
      });

    getMe()
      .then((result) => {
        if (!active) return;
        setRole(result.user.systemRole);
        if (result.user.systemRole !== "super_admin") {
          setLoadingAi(false);
          return;
        }

        getAiSettings()
          .then((aiResult) => {
            if (!active) return;
            const aiReady = Boolean(
              aiResult.settings.enabled && aiResult.settings.activeConfigId,
            );
            setSummary((current) => ({ ...current, aiReady }));
            setAiTask(
              aiReady
                ? null
                : {
                    href: APP_ROUTES.adminAi,
                    title: "AI 助手尚未完整启用",
                    detail: "检查全局开关与当前模型配置。",
                    level: "info",
                  },
            );
          })
          .catch(() => undefined)
          .finally(() => {
            if (active) setLoadingAi(false);
          });
      })
      .catch(() => {
        if (active) {
          setRole("member");
          setLoadingAi(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="workspace admin-workspace admin-overview-page">
      <header className="page-head">
        <div>
          <p className="page-eyebrow">系统管理</p>
          <h1>管理总览</h1>
          <p className="muted">集中配置成员、权限、存储与平台服务。</p>
        </div>
      </header>

      <section className="admin-summary-strip" aria-label="管理概览">
        <article>
          <span>成员</span>
          {summary.memberCount === null ? (
            <span className="skeleton-block admin-summary-value-skeleton" />
          ) : (
            <strong>{summary.memberCount}</strong>
          )}
          <small>
            {summary.disabledCount === null
              ? "正在读取成员状态"
              : summary.disabledCount
                ? `${summary.disabledCount} 个账号已停用`
                : "所有账号状态正常"}
          </small>
        </article>
        <article>
          <span>存储占用</span>
          {summary.storageUsedBytes === null ? (
            <span className="skeleton-block admin-summary-value-skeleton" />
          ) : (
            <strong>{formatStorageSize(summary.storageUsedBytes)}</strong>
          )}
          <small>
            {summary.storageQuotaBytes !== null
              ? `总上限 ${formatStorageSize(summary.storageQuotaBytes)}`
              : "正在读取容量信息"}
          </small>
        </article>
        <article>
          <span>AI 服务</span>
          {loadingAi ? (
            <span className="skeleton-block admin-summary-value-skeleton" />
          ) : (
            <strong>
              {summary.aiReady === null
                ? "不可配置"
                : summary.aiReady
                  ? "可用"
                  : "待配置"}
            </strong>
          )}
          <small>
            {summary.aiReady === null
              ? "仅最高管理员可配置"
              : summary.aiReady
                ? "当前模型配置有效"
                : "检查开关与模型配置"}
          </small>
        </article>
      </section>

      <div className="admin-overview-grid">
        <section className="admin-task-panel">
          <div className="panel-head">
            <div>
              <h2>待处理事项</h2>
              <p className="muted">根据当前账号和系统状态自动汇总。</p>
            </div>
          </div>
          <div className="admin-task-list">
            {tasks.map((task) => (
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
            {tasksLoading ? (
              <div className="skeleton admin-task-skeleton" />
            ) : null}
            {!tasksLoading && tasks.length === 0 ? (
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
              <h2>常用管理</h2>
              <p className="muted">快速进入常用的管理任务。</p>
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

function formatStorageSize(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}
