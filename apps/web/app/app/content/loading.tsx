import "./content.css";

function TreeRows() {
  return (
    <div className="content-tree-skeleton" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div className="content-tree-skeleton-row" key={index}>
          <span className="skeleton-block content-tree-skeleton-toggle" />
          <span className="skeleton-block content-tree-skeleton-icon" />
          <span className="skeleton-block content-tree-skeleton-label" />
        </div>
      ))}
    </div>
  );
}

function TableRows() {
  return (
    <tbody>
      {Array.from({ length: 6 }, (_, index) => (
        <tr className="content-table-skeleton-row" key={index}>
          <td>
            <span className="content-table-skeleton-name">
              <span className="skeleton-block content-table-skeleton-icon" />
              <span className="skeleton-block content-table-skeleton-title" />
            </span>
          </td>
          <td>
            <span className="skeleton-block content-table-skeleton-time" />
          </td>
          <td>
            <span className="skeleton-block content-table-skeleton-action" />
          </td>
        </tr>
      ))}
    </tbody>
  );
}

export default function ContentLoading() {
  return (
    <div
      aria-label="正在加载文档"
      className="workspace content-workspace"
      role="status"
    >
      <section className="content-drive-layout">
        <aside className="content-drive-sidebar" aria-hidden="true">
          <div className="content-loading-nav">
            <span className="skeleton-block" />
            <span className="skeleton-block" />
            <span className="skeleton-block" />
          </div>
          <div className="content-drive-sidebar-title">文件夹</div>
          <TreeRows />
        </aside>

        <div className="content-drive-main">
          <div className="content-drive-toolbar content-loading-toolbar">
            <div className="content-drive-location">
              <span className="content-loading-location">文档</span>
            </div>
            <span className="skeleton-block content-loading-search" />
            <div className="content-loading-actions" aria-hidden="true">
              <span className="skeleton-block" />
              <span className="skeleton-block" />
              <span className="skeleton-block wide" />
            </div>
          </div>

          <div className="content-drive-content">
            <div className="content-drive-list table-wrap">
              <table className="table responsive-table content-items-table content-drive-table">
                <thead>
                  <tr>
                    <th scope="col">文件名</th>
                    <th scope="col">最近更新</th>
                    <th scope="col">
                      <span className="sr-only">操作</span>
                    </th>
                  </tr>
                </thead>
                <TableRows />
              </table>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
