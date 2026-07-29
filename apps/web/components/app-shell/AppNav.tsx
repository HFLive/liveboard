"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Bell,
  ChevronDown,
  Files,
  MessageSquare,
  Presentation,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import type { ActivityItem, UserSummary } from "@liveboard/shared";
import {
  apiResourceUrl,
  dismissActivity,
  getMe,
  listActivity,
  markActivityRead,
} from "@/lib/api";
import { formatRelativeTime } from "@/lib/labels";
import { APP_ROUTES, userProfile } from "@/lib/routes";
import { LogoutButton } from "./LogoutButton";
import { SiteBrandMark } from "./SiteBrandMark";

const navItems = [
  { href: APP_ROUTES.classrooms, label: "课堂", Icon: Presentation },
  { href: APP_ROUTES.content, label: "文档", Icon: Files },
  { href: APP_ROUTES.forum, label: "论坛", Icon: MessageSquare },
  { href: APP_ROUTES.admin, label: "管理", Icon: Users },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isPrimaryNavActive(pathname: string, href: string) {
  if (
    href === APP_ROUTES.content &&
    (pathname === APP_ROUTES.ai || pathname === APP_ROUTES.library)
  ) {
    return true;
  }

  return isActive(pathname, href);
}

export function AppNav() {
  const pathname = usePathname();
  const isPresentationRoute =
    /^\/app\/(?:content\/[^/]+|teaching\/[^/]+)\/present$/.test(pathname);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([]);
  const [activityUnreadCount, setActivityUnreadCount] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const activeNavLinkRef = useRef<HTMLAnchorElement | null>(null);
  const displayName = userLoaded ? (user?.displayName ?? "未登录") : "账户信息";
  const userInitial = userLoaded
    ? displayName.trim().slice(0, 1).toUpperCase() || "L"
    : "…";
  const visibleNavItems =
    user && ["super_admin", "admin"].includes(user.systemRole)
      ? navItems
      : navItems.filter((item) => item.href !== APP_ROUTES.admin);
  const isProfileRoute =
    pathname === APP_ROUTES.profile || pathname.startsWith("/app/users/");
  const activeNavItem = visibleNavItems.find((item) =>
    isPrimaryNavActive(pathname, item.href),
  );
  const currentNavItem =
    activeNavItem ??
    (isProfileRoute
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
    if (!user) return;

    const loadSecondaryNavigationData = () => void loadActivity();
    const usesIdleCallback = typeof window.requestIdleCallback === "function";
    const idleCallback: number = usesIdleCallback
      ? window.requestIdleCallback(loadSecondaryNavigationData, {
          timeout: 800,
        })
      : (globalThis.setTimeout(
          loadSecondaryNavigationData,
          250,
        ) as unknown as number);

    return () => {
      if (usesIdleCallback) {
        window.cancelIdleCallback(idleCallback);
      } else {
        globalThis.clearTimeout(idleCallback);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const timer = window.setInterval(() => void loadActivity(), 60_000);
    return () => window.clearInterval(timer);
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
        href={APP_ROUTES.classrooms}
        title="LiveBoard 首页"
      >
        <SiteBrandMark className="rail-mark" tone="dark" />
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
        {isProfileRoute ? (
          <MobileProfileAvatar
            avatarUrl={user?.avatarUrl}
            fallback={userInitial}
          />
        ) : (
          <ActiveNavIcon aria-hidden="true" />
        )}
        <span>{currentNavItem.label}</span>
        {mobileMenuOpen ? (
          <X aria-hidden="true" />
        ) : (
          <ChevronDown aria-hidden="true" />
        )}
      </button>

      {mobileMenuOpen ? (
        <button
          aria-label="关闭主菜单"
          className="rail-mobile-backdrop"
          onClick={() => setMobileMenuOpen(false)}
          type="button"
        />
      ) : null}

      <nav className="rail-nav" aria-label="主导航">
        {visibleNavItems.map((item) => {
          const Icon = item.Icon;
          const active = isPrimaryNavActive(pathname, item.href);

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
        <div className="rail-mobile-footer-row">
          <div className="rail-mobile-account-actions">
            <Link
              href={user ? userProfile(user.id) : APP_ROUTES.profile}
              onClick={() => setMobileMenuOpen(false)}
            >
              <MobileProfileAvatar
                avatarUrl={user?.avatarUrl}
                fallback={userInitial}
              />
              <span>个人主页</span>
            </Link>
            <LogoutButton />
          </div>
        </div>
      </nav>

      <div className="rail-footer">
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

function MobileProfileAvatar({
  avatarUrl,
  fallback,
}: {
  avatarUrl?: string | null;
  fallback: string;
}) {
  return (
    <span className="rail-mobile-profile-avatar" aria-hidden="true">
      {avatarUrl ? <img alt="" src={apiResourceUrl(avatarUrl)} /> : fallback}
    </span>
  );
}

function activityKindLabel(kind: ActivityItem["kind"]) {
  return { exercise: "练习", grading: "批改", forum: "论坛" }[kind];
}
