"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bot,
  ClipboardList,
  Database,
  Files,
  MessageSquare,
  Presentation,
  Settings,
  Users,
} from "lucide-react";
import type { UserSummary } from "@liveboard/shared";
import { apiResourceUrl, getMe } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
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

export function AppNav() {
  const pathname = usePathname();
  const isPresentationRoute =
    /^\/app\/(?:content\/[^/]+|teaching\/[^/]+)\/present$/.test(pathname);
  const [user, setUser] = useState<UserSummary | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
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
          title="个人主页"
        >
          <span className="rail-avatar" aria-hidden="true">
            {user?.avatarUrl ? (
              <img alt="" src={apiResourceUrl(user.avatarUrl)} />
            ) : (
              userInitial
            )}
          </span>
          <span className="rail-user-copy">
            <span>{displayName}</span>
            <small>
              {userLoaded
                ? user
                  ? roleLabel(user.systemRole)
                  : "请重新登录"
                : "加载中…"}
            </small>
          </span>
        </Link>
        <Link
          aria-current={
            isActive(pathname, APP_ROUTES.profile) ? "page" : undefined
          }
          className="nav-button"
          href={APP_ROUTES.profile}
          title="个人设置"
        >
          <Settings aria-hidden="true" />
        </Link>
        <LogoutButton />
      </div>
    </aside>
  );
}
