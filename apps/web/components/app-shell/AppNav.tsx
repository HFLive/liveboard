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
  Settings,
  Users,
} from "lucide-react";
import type { UserSummary } from "@liveboard/shared";
import { getMe } from "@/lib/api";
import { roleLabel } from "@/lib/labels";
import { APP_ROUTES } from "@/lib/routes";
import { LogoutButton } from "./LogoutButton";

const navItems = [
  { href: APP_ROUTES.ai, label: "AI 助手", Icon: Bot },
  { href: APP_ROUTES.content, label: "课程内容", Icon: Files },
  { href: APP_ROUTES.library, label: "素材库", Icon: Database },
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
  const isPresentationRoute = /^\/app\/content\/[^/]+\/present$/.test(pathname);
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
      <Link className="rail-brand" href={APP_ROUTES.root}>
        <span className="rail-mark">LB</span>
        <span className="rail-brand-copy">
          <strong>LiveBoard</strong>
          <small>教学工作台</small>
        </span>
      </Link>

      <nav className="rail-nav" aria-label="主导航">
        <span className="rail-section-label">工作区</span>
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
        <div className="rail-user">
          <span className="rail-avatar" aria-hidden="true">
            {userInitial}
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
        </div>
        <Link
          aria-current={
            isActive(pathname, APP_ROUTES.profile) ? "page" : undefined
          }
          className={
            isActive(pathname, APP_ROUTES.profile)
              ? "rail-account-link active"
              : "rail-account-link"
          }
          href={APP_ROUTES.profile}
        >
          <Settings aria-hidden="true" className="rail-icon" />
          个人设置
        </Link>
        <LogoutButton />
      </div>
    </aside>
  );
}
