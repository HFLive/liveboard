import { BadgeCheck } from "lucide-react";
import type { BadgeSummary } from "@liveboard/shared";

export function UserBadges({
  badges,
  className,
}: {
  badges?: BadgeSummary[];
  className?: string;
}) {
  if (!badges?.length) return null;

  return (
    <span
      aria-label={`佩戴徽章：${badges.map((badge) => badge.name).join("、")}`}
      className={["user-badges", className].filter(Boolean).join(" ")}
    >
      {badges.slice(0, 3).map((badge) => (
        <span
          className="user-badge"
          data-color={badge.color}
          key={badge.id}
          title={badge.description || badge.name}
        >
          <BadgeCheck aria-hidden="true" />
          <span>{badge.name}</span>
        </span>
      ))}
    </span>
  );
}
