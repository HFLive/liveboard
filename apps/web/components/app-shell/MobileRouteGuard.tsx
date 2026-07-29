"use client";

import { MonitorUp } from "lucide-react";
import { usePathname } from "next/navigation";

const desktopOnlyRoutes = [
  {
    pattern: /^\/app\/admin(?:\/|$)/,
    title: "管理中心仅支持电脑端",
    detail: "成员、权限和系统配置涉及密集表格与批量操作，请使用电脑完成。",
  },
] as const;

export function MobileRouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const blockedRoute = desktopOnlyRoutes.find(({ pattern }) =>
    pattern.test(pathname),
  );

  if (!blockedRoute) {
    return children;
  }

  return (
    <>
      <section className="mobile-route-unsupported" role="status">
        <MonitorUp aria-hidden="true" />
        <div>
          <strong>{blockedRoute.title}</strong>
          <p>{blockedRoute.detail}</p>
        </div>
      </section>
      <div className="mobile-route-content is-desktop-only">{children}</div>
    </>
  );
}
