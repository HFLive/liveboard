"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Bell,
  ClipboardList,
  Database,
  Files,
  MessageSquare,
  Presentation,
  Users,
  X,
} from "lucide-react";
import type {
  ActivityItem,
  AiUsageSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  apiResourceUrl,
  getAiUsage,
  getMe,
  listActivity,
  markActivityRead,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import { APP_ROUTES, userProfile } from "@/lib/routes";
import { LogoutButton } from "./LogoutButton";

const navItems = [
  { href: APP_ROUTES.ai, label: "AI", Icon: Bot },
  { href: APP_ROUTES.content, label: "文档", Icon: Files },
  { href: APP_ROUTES.teaching, label: "课件", Icon: Presentation },
  { href: APP_ROUTES.library, label: "文件", Icon: Database },
  { href: APP_ROUTES.exercises, label: "练习", Icon: ClipboardList },
  { href: APP_ROUTES.forum, label: "论坛", Icon: MessageSquare },
  { href: APP_ROUTES.admin, label: "管理", Icon: Users },
] as const;

function isActive(pathname: string, href: string) {
  if (href === APP_ROUTES.ai) {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

const USAGE_HOVER_DELAY_MS = 150;

export function AppNav() {
  const pathname = usePathname();
  const isPresentationRoute =
    /^\/app\/(?:content\/[^/]+|teaching\/[^/]+)\/present$/.test(pathname);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [usage, setUsage] = useState<AiUsageSummary | null>(null);
  const [usageFailed, setUsageFailed] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityUnreadCount, setActivityUnreadCount] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [usagePosition, setUsagePosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const accountLinkRef = useRef<HTMLAnchorElement | null>(null);
  const activeNavLinkRef = useRef<HTMLAnchorElement | null>(null);
  const usageHoverTimerRef = useRef<number | null>(null);
  const usageLoadingRef = useRef(false);
  const displayName = userLoaded ? (user?.displayName ?? "未登录") : "账户信息";
  const userInitial = userLoaded
    ? displayName.trim().slice(0, 1).toUpperCase() || "L"
    : "…";
  const visibleNavItems =
    user && ["super_admin", "admin"].includes(user.systemRole)
      ? navItems
      : navItems.filter((item) => item.href !== APP_ROUTES.admin);

  useEffect(() => {
    let active = true;

    function loadMe() {
      getMe()
        .then((result) => {
          if (active) {
            setUser(result.user);
          }
        })
        .catch(() => {
          if (active) {
            setUser(null);
          }
        })
        .finally(() => {
          if (active) {
            setUserLoaded(true);
          }
        });
    }

    loadMe();
    window.addEventListener("liveboard:profile-updated", loadMe);

    return () => {
      active = false;
      window.removeEventListener("liveboard:profile-updated", loadMe);
    };
  }, []);

  useEffect(() => {
    activeNavLinkRef.current?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "center",
    });
  }, [pathname, user?.id]);

  useEffect(() => {
    if (user) {
      loadUsage();
      void loadActivity();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void loadActivity(), 60_000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    return () => {
      if (usageHoverTimerRef.current !== null) {
        window.clearTimeout(usageHoverTimerRef.current);
      }
    };
  }, []);

  function loadUsage() {
    if (usageLoadingRef.current) {
      return;
    }

    usageLoadingRef.current = true;
    getAiUsage()
      .then((result) => {
        setUsage(result);
        setUsageFailed(false);
      })
      .catch(() => {
        setUsageFailed(true);
      })
      .finally(() => {
        usageLoadingRef.current = false;
      });
  }

  async function loadActivity() {
    try {
      const result = await listActivity();
      setActivityItems(result.items);
      setActivityUnreadCount(result.unreadCount);
      return result;
    } catch {
      // 导航通知是辅助能力，加载失败不影响主导航。
      return null;
    }
  }

  async function toggleActivity() {
    const nextOpen = !activityOpen;
    setActivityOpen(nextOpen);
    setUsageOpen(false);
    if (nextOpen) {
      const result = await loadActivity();
      if ((result?.unreadCount ?? activityUnreadCount) > 0) {
        try {
          await markActivityRead();
          setActivityUnreadCount(0);
          setActivityItems((current) =>
            current.map((item) => ({ ...item, unread: false })),
          );
        } catch {
          // 保留未读状态，下次打开时重试。
        }
      }
    }
  }

  function onAccountMouseEnter() {
    if (!user) {
      return;
    }

    if (usageHoverTimerRef.current !== null) {
      window.clearTimeout(usageHoverTimerRef.current);
    }

    usageHoverTimerRef.current = window.setTimeout(() => {
      usageHoverTimerRef.current = null;
      const rect = accountLinkRef.current?.getBoundingClientRect();

      if (!rect) {
        return;
      }

      setUsagePosition({
        left: rect.left,
        bottom: window.innerHeight - rect.top + 8,
      });
      setUsageOpen(true);
      loadUsage();
    }, USAGE_HOVER_DELAY_MS);
  }

  function onAccountMouseLeave() {
    if (usageHoverTimerRef.current !== null) {
      window.clearTimeout(usageHoverTimerRef.current);
      usageHoverTimerRef.current = null;
    }

    setUsageOpen(false);
  }

  const usagePercent = usage
    ? usage.limit === 0
      ? 100
      : Math.min(100, Math.round((usage.used / usage.limit) * 100))
    : 0;
  const usageExceeded = usage ? usage.used >= usage.limit : false;

  if (isPresentationRoute) {
    return null;
  }

  return (
    <aside className="app-rail">
      <Link
        aria-label="LiveBoard 首页"
        className="rail-brand"
        href={APP_ROUTES.root}
        title="LiveBoard 首页"
      >
        <span className="rail-mark" aria-hidden="true">
          LB
        </span>
      </Link>

      <nav className="rail-nav" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const Icon = item.Icon;
          const active = isActive(pathname, item.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "rail-link active" : "rail-link"}
              href={item.href}
              key={item.href}
              ref={active ? activeNavLinkRef : undefined}
              title={item.label}
            >
              <Icon aria-hidden="true" className="rail-icon" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="rail-footer">
        {user && usage ? (
          <div
            aria-label={`今日 AI 额度已用 ${usage.used} / ${usage.limit} 次`}
            className="rail-usage-strip"
            role="status"
          >
            <div className="rail-usage-strip-head">
              <span>今日 AI</span>
              <span>{usagePercent}%</span>
            </div>
            <span className="rail-usage-strip-bar" aria-hidden="true">
              <span
                className={
                  usageExceeded
                    ? "rail-usage-bar-fill is-over"
                    : "rail-usage-bar-fill"
                }
                style={{ width: `${usagePercent}%` }}
              />
            </span>
          </div>
        ) : null}
        <button
          aria-expanded={activityOpen}
          aria-label={
            activityUnreadCount > 0
              ? `消息，${activityUnreadCount} 条未读`
              : "消息"
          }
          className={
            activityOpen
              ? "rail-activity-button active"
              : "rail-activity-button"
          }
          onClick={() => void toggleActivity()}
          title="消息"
          type="button"
        >
          <Bell aria-hidden="true" />
          <span>消息</span>
          {activityUnreadCount > 0 ? (
            <em>{activityUnreadCount > 99 ? "99+" : activityUnreadCount}</em>
          ) : null}
        </button>
        <div className="rail-account-row">
          <Link
            aria-current={
              user && isActive(pathname, userProfile(user.id))
                ? "page"
                : undefined
            }
            className={
              user && isActive(pathname, userProfile(user.id))
                ? "rail-user active"
                : "rail-user"
            }
            href={user ? userProfile(user.id) : APP_ROUTES.profile}
            onMouseEnter={onAccountMouseEnter}
            onMouseLeave={onAccountMouseLeave}
            ref={accountLinkRef}
            rel="noopener noreferrer"
            target="_blank"
            title={displayName}
          >
            <span className="rail-avatar" aria-hidden="true">
              {user?.avatarUrl ? (
                <img alt="" src={apiResourceUrl(user.avatarUrl)} />
              ) : (
                userInitial
              )}
            </span>
          </Link>
          <LogoutButton />
        </div>
      </div>

      {usageOpen && user && usagePosition ? (
        <div
          className="rail-usage-popover"
          role="status"
          style={{ left: usagePosition.left, bottom: usagePosition.bottom }}
        >
          <div className="rail-usage-user">
            <span className="rail-avatar" aria-hidden="true">
              {user.avatarUrl ? (
                <img alt="" src={apiResourceUrl(user.avatarUrl)} />
              ) : (
                userInitial
              )}
            </span>
            <strong>{displayName}</strong>
          </div>
        </div>
      ) : null}

      {activityOpen ? (
        <div className="rail-activity-popover" role="dialog" aria-label="消息">
          <div className="rail-activity-head">
            <strong>消息</strong>
            <button
              aria-label="关闭消息"
              onClick={() => setActivityOpen(false)}
              title="关闭"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="rail-activity-list">
            {activityItems.map((item) => (
              <Link
                href={item.href as Route}
                key={item.id}
                onClick={() => setActivityOpen(false)}
              >
                <span className={`activity-kind ${item.kind}`}>
                  {activityKindLabel(item.kind)}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.detail} · {formatRelativeTime(item.occurredAt)}
                  </small>
                </span>
              </Link>
            ))}
            {activityItems.length === 0 ? (
              <div className="rail-activity-empty">
                <strong>暂无消息</strong>
                <span>练习、批改、文档和论坛消息会显示在这里。</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </aside>
  );
}

function activityKindLabel(kind: ActivityItem["kind"]) {
  return { exercise: "练习", grading: "批改", document: "文档", forum: "论坛" }[
    kind
  ];
}
