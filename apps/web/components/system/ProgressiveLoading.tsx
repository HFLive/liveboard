type SkeletonRowsProps = {
  count?: number;
  compact?: boolean;
};

export function SkeletonRows({
  count = 5,
  compact = false,
}: SkeletonRowsProps) {
  return (
    <div
      aria-label="正在加载内容"
      className={`progressive-list-skeleton${compact ? " compact" : ""}`}
      role="status"
    >
      {Array.from({ length: count }, (_, index) => (
        <div className="progressive-list-skeleton-row" key={index}>
          <span className="skeleton-block skeleton-avatar" />
          <span className="progressive-list-skeleton-copy">
            <span className="skeleton-block skeleton-line primary" />
            <span className="skeleton-block skeleton-line secondary" />
          </span>
          <span className="skeleton-block skeleton-action" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeletonRows({
  colSpan,
  count = 5,
}: {
  colSpan: number;
  count?: number;
}) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <tr
          aria-hidden="true"
          className="progressive-table-skeleton-row"
          key={index}
        >
          <td colSpan={colSpan}>
            <span className="skeleton-block skeleton-line primary" />
            <span className="skeleton-block skeleton-line secondary" />
            <span className="skeleton-block skeleton-action" />
          </td>
        </tr>
      ))}
    </>
  );
}

export function RouteContentSkeleton() {
  return (
    <div
      aria-label="正在加载页面"
      className="workspace route-content-skeleton"
      role="status"
    >
      <div className="route-skeleton-heading">
        <span className="skeleton-block skeleton-title" />
        <span className="skeleton-block skeleton-subtitle" />
      </div>
      <div className="route-skeleton-toolbar">
        <span className="skeleton-block skeleton-search" />
        <span className="skeleton-block skeleton-button" />
      </div>
      <SkeletonRows count={6} />
    </div>
  );
}
