import Link from "next/link";
import type { UserSummary } from "@liveboard/shared";
import { userProfile } from "@/lib/routes";
import { UserBadges } from "./UserBadges";

type UserProfileLinkProps = {
  user: Pick<UserSummary, "id" | "displayName" | "badges">;
  className?: string;
  children?: React.ReactNode;
  compactBadges?: boolean;
};

export function UserProfileLink({
  user,
  className,
  children,
  compactBadges = false,
}: UserProfileLinkProps) {
  return (
    <Link
      className={["user-profile-link", className].filter(Boolean).join(" ")}
      href={userProfile(user.id)}
      rel="noopener noreferrer"
      target="_blank"
    >
      <span>{children ?? user.displayName}</span>
      <UserBadges badges={user.badges} compact={compactBadges} />
    </Link>
  );
}
