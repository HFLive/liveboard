import Link from "next/link";
import type { UserSummary } from "@liveboard/shared";
import { userProfile } from "@/lib/routes";

type UserProfileLinkProps = {
  user: Pick<UserSummary, "id" | "displayName">;
  className?: string;
  children?: React.ReactNode;
};

export function UserProfileLink({
  user,
  className,
  children,
}: UserProfileLinkProps) {
  return (
    <Link
      className={className}
      href={userProfile(user.id)}
      rel="noopener noreferrer"
      target="_blank"
    >
      {children ?? user.displayName}
    </Link>
  );
}
