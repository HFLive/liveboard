import { Loader2 } from "lucide-react";

/**
 * 全站统一的轻量旋转加载图标。
 * 动画定义在 `redesign.css` 的 `.spinner`（尊重 `prefers-reduced-motion`）。
 */
export function Spinner({
  size = 16,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <Loader2
      aria-hidden="true"
      className={className ? `spinner ${className}` : "spinner"}
      size={size}
    />
  );
}

/**
 * 旋转图标 + 文字的「加载中」提示，用于替换纯文字加载状态。
 * 自带 `role="status"`，供屏幕阅读器播报。
 */
export function InlineLoading({
  label,
  size = 14,
  className = "",
}: {
  label: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={className ? `inline-loading ${className}` : "inline-loading"}
      role="status"
    >
      <Spinner size={size} />
      <span>{label}</span>
    </span>
  );
}
