"use client";

import { MonitorUp } from "lucide-react";
import { usePathname } from "next/navigation";

const desktopOnlyRoutes = [
  {
    pattern: /^\/app\/admin(?:\/|$)/,
    title: "管理中心仅支持电脑端",
    detail: "成员、权限和系统配置涉及密集表格与批量操作，请使用电脑完成。",
  },
  {
    pattern: /^\/app\/content\/[^/]+\/edit$/,
    title: "文档编辑仅支持电脑端",
    detail: "手机端仍可阅读文档；段落编排、公式与附件编辑请使用电脑完成。",
  },
  {
    pattern: /^\/app\/teaching\/(?:new|[^/]+\/edit)$/,
    title: "课件编排仅支持电脑端",
    detail: "手机端仍可查看和播放课件；内容编排请使用电脑完成。",
  },
  {
    pattern: /^\/app\/exercises\/new$/,
    title: "创建练习仅支持电脑端",
    detail: "手机端仍可查看和作答练习；题目编排请使用电脑完成。",
  },
  {
    pattern: /^\/app\/exercises\/[^/]+\/submissions$/,
    title: "批改仅支持电脑端",
    detail: "逐题评分与批量处理请使用电脑完成。",
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
