import type { UserSummary } from "@liveboard/shared";

export function IdentityName({
  user,
}: {
  user: Pick<UserSummary, "displayName" | "identityLabel" | "realName">;
}) {
  const details = [user.identityLabel, user.realName].filter(Boolean).join(" ");
  return (
    <span className="identity-name">
      <span className="identity-name-primary">{user.displayName}</span>
      {details ? (
        <small className="identity-name-details">（{details}）</small>
      ) : null}
    </span>
  );
}
