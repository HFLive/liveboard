import type { UserSummary } from "@liveboard/shared";
import { apiResourceUrl } from "@/lib/api";

interface ForumUserAvatarProps {
  className: string;
  user: Pick<UserSummary, "avatarUrl" | "displayName">;
  isAnonymous?: boolean;
}

export function ForumUserAvatar({
  className,
  user,
  isAnonymous = false,
}: ForumUserAvatarProps) {
  return (
    <span className={className} aria-hidden="true">
      {isAnonymous ? (
        "匿"
      ) : user.avatarUrl ? (
        <img alt="" src={apiResourceUrl(user.avatarUrl)} />
      ) : (
        user.displayName.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}
