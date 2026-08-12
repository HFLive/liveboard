"use client";

import { useEffect, useRef, useState } from "react";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { getMaintenanceStatus } from "@/lib/api";

/** 首次失败后的快速重试间隔：移动端网络冷启动或页面从 bfcache 恢复时，
 * 在途请求可能瞬断一次，快速重试能避免误报。 */
const QUICK_RETRY_MS = 1_500;
/** 连续失败多少次才提示「状态未知」：单次瞬断不报警，真实故障很快会连续失败。 */
const CONSECUTIVE_FAILURES_TO_ALARM = 2;

/**
 * 维护/只读模式横幅。读取公开的 maintenance/status（登录与否都能显示），
 * 每 30 秒刷新一次。最高管理员可到「管理中心 → 数据迁移」页关闭维护模式。
 * 失败提示只在连续多次获取失败且设备在线时出现（而非任何一次网络瞬断），
 * 避免维护实际开启时用户毫不知情，又不因瞬断误报。
 */
export function MaintenanceBanner() {
  const [enabled, setEnabled] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [unknown, setUnknown] = useState(false);
  const failuresRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      getMaintenanceStatus()
        .then((status) => {
          if (!active) return;
          failuresRef.current = 0;
          setEnabled(status.enabled);
          setReason(status.reason);
          setUnknown(false);
        })
        .catch(() => {
          if (!active) return;
          // 设备离线时静默：离线≠维护中，联网后由 online 事件触发重拉。
          if (!navigator.onLine) return;
          failuresRef.current += 1;
          if (failuresRef.current === 1) {
            retryTimerRef.current = window.setTimeout(load, QUICK_RETRY_MS);
          }
          setUnknown(failuresRef.current >= CONSECUTIVE_FAILURES_TO_ALARM);
        });
    };
    load();
    const timer = window.setInterval(load, 30_000);
    // 移动端关闭浏览器再进入时页面从 bfcache 恢复：恢复瞬间在途请求已失败，
    // 页面重新可见/联网时立即重拉，不等下一个 30 秒轮询，避免误报持续显示。
    const onPageshow = (event: PageTransitionEvent) => {
      if (event.persisted) load();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") load();
    };
    const onOnline = () => load();
    window.addEventListener("pageshow", onPageshow);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      active = false;
      window.clearInterval(timer);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
      window.removeEventListener("pageshow", onPageshow);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
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
