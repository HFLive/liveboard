"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Bell,
  ChevronDown,
  ClipboardList,
  Database,
  Files,
  MessageSquare,
  Presentation,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import type {
  ActivityItem,
  AiUsageSummary,
  UserSummary,
} from "@liveboard/shared";
import {
  AI_USAGE_CONSUMED_EVENT,
  apiResourceUrl,
  dismissActivity,
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [usagePosition, setUsagePosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const accountLinkRef = useRef<HTMLAnchorElement | null>(null);
  const activeNavLinkRef = useRef<HTMLAnchorElement | null>(null);
  const usageHoverTimerRef = useRef<number | null>(null);
  const usageLoadingRef = useRef(false);
  const usageReloadPendingRef = useRef(false);
  const displayName = userLoaded ? (user?.displayName ?? "未登录") : "账户信息";
  const userInitial = userLoaded
    ? displayName.trim().slice(0, 1).toUpperCase() || "L"
    : "…";
  const visibleNavItems =
    user && ["super_admin", "admin"].includes(user.systemRole)
      ? navItems
      : navItems.filter((item) => item.href !== APP_ROUTES.admin);
  const activeNavItem = visibleNavItems.find((item) =>
    isActive(pathname, item.href),
  );
  const currentNavItem =
    activeNavItem ??
    (pathname === APP_ROUTES.profile || pathname.startsWith("/app/users/")
      ? { label: "个人主页", Icon: UserCircle }
      : { label: "LiveBoard", Icon: Bot });
  const ActiveNavIcon = currentNavItem.Icon;

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
    setMobileMenuOpen(false);
  }, [pathname]);

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
      usageReloadPendingRef.current = true;
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
        if (usageReloadPendingRef.current) {
          usageReloadPendingRef.current = false;
          loadUsage();
        }
      });
  }

  useEffect(() => {
    if (!user) return;

    function onAiUsageConsumed() {
      setUsage((current) =>
        current
          ? { ...current, used: Math.min(current.used + 1, current.limit) }
          : current,
      );
      loadUsage();
    }

    window.addEventListener(AI_USAGE_CONSUMED_EVENT, onAiUsageConsumed);
    return () =>
      window.removeEventListener(AI_USAGE_CONSUMED_EVENT, onAiUsageConsumed);
    // loadUsage 使用 ref 串行刷新；仅在登录用户变化时重新绑定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

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
    setMobileMenuOpen(false);
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

  async function onDismissActivity(item: ActivityItem) {
    setActivityItems((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
    if (item.unread) {
      setActivityUnreadCount((current) => Math.max(0, current - 1));
    }

    try {
      await dismissActivity(item.id);
    } catch {
      await loadActivity();
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
    <aside
      className={mobileMenuOpen ? "app-rail mobile-menu-open" : "app-rail"}
    >
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

      <button
        aria-expanded={mobileMenuOpen}
        aria-label={mobileMenuOpen ? "关闭主菜单" : "打开主菜单"}
        className="rail-mobile-menu-toggle"
        onClick={() => {
          setActivityOpen(false);
          setMobileMenuOpen((current) => !current);
        }}
        type="button"
      >
        <ActiveNavIcon aria-hidden="true" />
        <span>{currentNavItem.label}</span>
        {mobileMenuOpen ? (
          <X aria-hidden="true" />
        ) : (
          <ChevronDown aria-hidden="true" />
        )}
      </button>

      <nav className="rail-nav" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const Icon = item.Icon;
          const active = isActive(pathname, item.href);

          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`${active ? "rail-link active" : "rail-link"}${
                item.href === APP_ROUTES.admin ? " mobile-complex-nav" : ""
              }`}
              href={item.href}
              key={item.href}
              onClick={() => setMobileMenuOpen(false)}
              ref={active ? activeNavLinkRef : undefined}
              title={item.label}
            >
              <Icon aria-hidden="true" className="rail-icon" />
              {item.label}
            </Link>
          );
        })}
        <div className="rail-mobile-account-actions">
          <Link
            href={user ? userProfile(user.id) : APP_ROUTES.profile}
            onClick={() => setMobileMenuOpen(false)}
          >
            <UserCircle aria-hidden="true" />
            <span>个人主页</span>
          </Link>
          <LogoutButton />
        </div>
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
              <div className="rail-activity-item" key={item.id}>
                <Link
                  href={item.href as Route}
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
                <button
                  aria-label={`移除消息“${item.title}”`}
                  className="rail-activity-dismiss"
                  onClick={() => void onDismissActivity(item)}
                  title="移除消息"
                  type="button"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
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
