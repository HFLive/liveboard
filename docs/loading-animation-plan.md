# 全站加载动画统一

> 状态：已按「方向 A」实施，随 PR #121 合入。方向 A = 区域加载沿用现有骨架屏 shimmer，只补齐纯文字与按钮级加载动画，统一为轻量转圈图标；**不引入**页面级琥珀细线（原规划中的备选方向，已明确不做）。

## 1. 背景

全站加载反馈此前三套并存且不完整：

- 骨架屏体系（`ProgressiveLoading.tsx` + `.skeleton` shimmer）已较完整，约 25 处复用；
- 部分加载态只是纯文字（「正在加载」「保存中…」），无任何动画；
- 部分按钮提交中仅 `disabled`，无视觉反馈。

## 2. 已实施内容（方向 A）

### 2.1 新增统一组件 `components/system/Loading.tsx`

- `Spinner({ size, className })`：lucide `Loader2` + 全局 `.spinner` 类。
- `InlineLoading({ label, size, className })`：转圈图标 + 文字，自带 `role="status"`。

### 2.2 收敛分散的 spinner 定义

删除 4 个管理页 CSS 中各自重复的 `.spin`/`@keyframes`（`admin/users/users.css`、`admin/backup/backup.css`、`admin/server-status/server-status.css`、`admin/migration/migration.css`），统一到 `redesign.css` 全局 `.spinner`（`0.85s linear infinite` + `will-change: transform`）。

### 2.3 覆盖的加载点

- 纯文字加载 → `InlineLoading`：登录确认、账号关联、课件加载、文本预览、消息「加载更多」、论坛/成员计数位、练习加载、AI 额度与历史、AI 会话切换。
- 按钮级操作 → `Spinner`：登录、关联、登出、练习创建/提交、论坛锁定/解锁/删除（`pendingAction` 精确到具体操作）。
- 修复 `BackupClient` pending 任务图标缺失 spin。

### 2.4 无障碍

全部动画尊重 `prefers-reduced-motion: reduce`（`.skeleton`、`.spinner` 均有关闭分支）。

## 3. 实现细节

```css
.spinner {
  flex: none;
  animation: liveboard-spin 0.85s linear infinite;
  will-change: transform;
}
.inline-loading {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  color: var(--muted);
}
@keyframes liveboard-spin {
  to {
    transform: rotate(360deg);
  }
}
```

尺寸约定：spinner 的实际尺寸由所在容器 CSS 控制（`.button-icon` 16px、`.icon-button svg` 16px、`.forum-thread-more-menu svg` 14px），组件 `size` 属性仅作兜底默认值，保证与原图标尺寸一致、无布局跳动。

## 4. 本次未实施（后续可选）

原规划中的以下项按方向 A 有意不做或留待后续，**未包含在本 PR**：

- 页面级琥珀细线扫动（原规划方向；方向 A 决定沿用 `RouteContentSkeleton` 骨架屏，不新增 `.page-progress`）。
- 「加载中误报空态」正确性修复（约 10 处 C 组：帖子正文、练习题目、令牌列表等 fetch 未完成时的空白/误报空态）。
- `FormSkeleton` 编辑模式初始 fetch 骨架。
- AI 回答等待期的「正在思考」指示。
- 其余纯文字按钮的机械替换（本 PR 覆盖主要交互路径，未穷尽原盘点约 40 处）。

## 5. 验证

- `pnpm --filter @liveboard/web typecheck` 通过。
- 相关 11 个测试文件、41 个用例全部通过。
- Prettier 检查通过。
- 骨架屏 shimmer 与 `.spinner` 均在 `prefers-reduced-motion: reduce` 下停用。
