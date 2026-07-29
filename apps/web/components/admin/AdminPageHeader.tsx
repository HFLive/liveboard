import type { ReactNode } from "react";

export function AdminPageHeader({
  actions,
  category,
  description,
  title,
}: {
  actions?: ReactNode;
  category: string;
  description: string;
  title: string;
}) {
  return (
    <header className="admin-page-header">
      <div className="admin-page-title">
        <span className="admin-page-kicker">{category}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="admin-page-actions">{actions}</div> : null}
    </header>
  );
}
