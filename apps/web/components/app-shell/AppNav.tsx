"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Bell,
  CheckCheck,
  ChevronDown,
  Files,
  MessageSquare,
  Presentation,
  UserCircle,
  Users,
  X,
} from "lucide-react";
import type { NotificationItem, UserSummary } from "@liveboard/shared";
import {
  apiResourceUrl,
  archiveNotification,
  getMe,
  listNotifications,
  markAllNotificationsRead,
  setNotificationRead,
} from "@/lib/api";
import { APP_ROUTES, userProfile } from "@/lib/routes";
import {
  broadcastNotificationsUpdated,
  NOTIFICATIONS_UPDATED_EVENT,
  type NotificationUpdateSource,
} from "@/lib/notifications";
import { NotificationList } from "@/components/notifications/NotificationList";
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
  const [activityItems, setActivityItems] = useState<NotificationItem[]>([]);
  const [activityUnreadCount, setActivityUnreadCount] = useState(0);
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityFilter, setActivityFilter] = useState<
    "all" | "unread" | "task"
  >("all");
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
  const isNotificationsRoute = pathname === APP_ROUTES.notifications;
  const activeNavItem = visibleNavItems.find((item) =>
    isPrimaryNavActive(pathname, item.href),
  );
  const currentNavItem =
    activeNavItem ??
    (isProfileRoute
      ? { label: "个人主页", Icon: UserCircle }
      : isNotificationsRoute
        ? { label: "消息", Icon: Bell }
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

    const loadSecondaryNavigationData = () => void loadActivity("all");
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
    const timer = window.setInterval(
      () => void loadActivity(activityFilter),
      60_000,
    );
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFilter, user]);

  useEffect(() => {
    if (!user) return;
    const onNotificationsUpdated = (event: Event) => {
      if ((event as CustomEvent<NotificationUpdateSource>).detail !== "nav") {
        void loadActivity(activityFilter);
      }
    };
    window.addEventListener(
      NOTIFICATIONS_UPDATED_EVENT,
      onNotificationsUpdated,
    );
    return () =>
      window.removeEventListener(
        NOTIFICATIONS_UPDATED_EVENT,
        onNotificationsUpdated,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activityFilter, user]);

  async function loadActivity(
    filter: "all" | "unread" | "task" = activityFilter,
  ) {
    try {
      const result = await listNotifications({
        status: filter === "unread" ? "unread" : "all",
        category: filter === "task" ? "task" : undefined,
        limit: 12,
      });
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
      await loadActivity();
    }
  }

  async function onArchiveActivity(item: NotificationItem) {
    setActivityItems((current) =>
      current.filter((candidate) => candidate.id !== item.id),
    );
    if (item.unread) {
      setActivityUnreadCount((current) => Math.max(0, current - 1));
    }

    try {
      await archiveNotification(item.id);
      broadcastNotificationsUpdated("nav");
    } catch {
      await loadActivity();
    }
  }

  async function onToggleActivityRead(item: NotificationItem) {
    const read = item.unread;
    setActivityItems((current) =>
      current
        .map((candidate) =>
          candidate.id === item.id
            ? { ...candidate, unread: !read }
            : candidate,
        )
        .filter((candidate) => activityFilter !== "unread" || candidate.unread),
    );
    setActivityUnreadCount((current) => Math.max(0, current + (read ? -1 : 1)));
    try {
      await setNotificationRead(item.id, read);
      broadcastNotificationsUpdated("nav");
    } catch {
      await loadActivity();
    }
  }

  function onOpenActivity(item: NotificationItem) {
    setActivityOpen(false);
    if (!item.unread) return;
    setActivityUnreadCount((current) => Math.max(0, current - 1));
    void setNotificationRead(item.id, true)
      .then(() => broadcastNotificationsUpdated("nav"))
      .catch(() => {
        void loadActivity();
      });
  }

  async function onMarkAllActivityRead() {
    if (activityUnreadCount === 0) return;
    try {
      await markAllNotificationsRead();
      setActivityUnreadCount(0);
      setActivityItems((current) =>
        activityFilter === "unread"
          ? []
          : current.map((item) => ({ ...item, unread: false })),
      );
      broadcastNotificationsUpdated("nav");
    } catch {
      await loadActivity();
    }
  }

  async function changeActivityFilter(filter: "all" | "unread" | "task") {
    setActivityFilter(filter);
    await loadActivity(filter);
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
        <ActiveNavIcon aria-hidden="true" />
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
            activityOpen || isNotificationsRoute
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
              isProfileRoute ? "rail-user profile-context" : "rail-user"
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
            <span>
              <strong>消息</strong>
              {activityUnreadCount > 0 ? (
                <small>{activityUnreadCount} 条未读</small>
              ) : null}
            </span>
            <div>
              <button
                aria-label="全部标为已读"
                disabled={activityUnreadCount === 0}
                onClick={() => void onMarkAllActivityRead()}
                title="全部已读"
                type="button"
              >
                <CheckCheck aria-hidden="true" />
              </button>
              <button
                aria-label="关闭消息"
                onClick={() => setActivityOpen(false)}
                title="关闭"
                type="button"
              >
                <X aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="rail-activity-filters" aria-label="消息筛选">
            {(
              [
                ["all", "全部"],
                ["unread", "未读"],
                ["task", "待处理"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={activityFilter === value}
                key={value}
                onClick={() => void changeActivityFilter(value)}
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="rail-activity-list">
            {activityItems.length > 0 ? (
              <NotificationList
                compact
                items={activityItems}
                onArchive={(item) => void onArchiveActivity(item)}
                onOpen={onOpenActivity}
                onToggleRead={(item) => void onToggleActivityRead(item)}
              />
            ) : (
              <div className="rail-activity-empty">
                <strong>
                  {activityFilter === "unread" ? "没有未读消息" : "暂无消息"}
                </strong>
                <span>课堂、练习、反馈和论坛动态会显示在这里。</span>
              </div>
            )}
          </div>
          <Link
            className="rail-activity-all"
            href={APP_ROUTES.notifications}
            onClick={() => setActivityOpen(false)}
          >
            查看全部消息
          </Link>
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
