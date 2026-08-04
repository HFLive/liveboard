"use client";

import { useEffect, useState } from "react";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { getMaintenanceStatus } from "@/lib/api";

/**
 * 维护/只读模式横幅。读取公开的 maintenance/status（登录与否都能显示），
 * 每 30 秒刷新一次。最高管理员可到「管理中心 → 数据迁移」页关闭维护模式。
 * 状态获取失败时显示中性提示而非静默隐藏，避免维护实际开启时用户毫不知情。
 */
export function MaintenanceBanner() {
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      getMaintenanceStatus()
        .then((status) => {
          if (!active) return;
          setEnabled(status.enabled);
          setReason(status.reason);
          setUnknown(false);
        })
        .catch(() => {
          if (!active) return;
          // 网络错误不打断页面；显示"状态未知"提示，下轮轮询自愈。
          setUnknown(true);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!enabled && !unknown) return null;

  return (
    <div className="maintenance-banner" role="status">
      {enabled ? (
        <ShieldAlert aria-hidden="true" />
      ) : (
        <TriangleAlert aria-hidden="true" />
      )}
      <span>
        {enabled ? (
          <>
            <strong>系统维护中，站点暂时只读</strong>
            {reason ? <span className="muted">：{reason}</span> : null}
          </>
        ) : (
          <strong>无法获取维护状态，请稍后重试</strong>
        )}
      </span>
    </div>
  );
}
