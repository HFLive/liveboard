"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Bot,
  ClipboardList,
  Database,
  Files,
  MessageSquare,
  Presentation,
  Users,
} from "lucide-react";
import type { AiUsageSummary, UserSummary } from "@liveboard/shared";
import { apiResourceUrl, getAiUsage, getMe } from "@/lib/api";
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
  const [usagePosition, setUsagePosition] = useState<{
    left: number;
    bottom: number;
  } | null>(null);
  const accountLinkRef = useRef<HTMLAnchorElement | null>(null);
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
    if (user) {
      loadUsage();
    }
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
            aria-label={`AI 额度已用 ${usage.used} / ${usage.limit} 次`}
            className="rail-usage-strip"
            role="status"
          >
            <div className="rail-usage-strip-head">
              <span>AI 额度</span>
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
    </aside>
  );
}
