# 全站加载动画统一规划

> 状态：规划完成，待实施。方向已与用户确认：**区域加载沿用骨架屏；按钮/行内状态统一为 12px 转圈图标 + 文字；页面级加载增加 2px 琥珀色细线扫动**。
> 本次只做规划，未改任何代码。

## 1. 背景与目标

全站加载反馈目前三套并存且不完整：

- 骨架屏体系（`ProgressiveLoading.tsx` + `.skeleton` shimmer）已较完整，约 25 处复用；
- 约 40 处加载态只是纯文字（"保存中…""正在加载"），无任何动画；
- 约 10 处加载期间完全空白，甚至误显示空态（如 fetch 未完成就显示"暂无提交"）。

目标：**每一处异步加载都有符合视觉语言的动画反馈**——骨架屏（区域）、转圈图标 + 文字（按钮/行内）、琥珀细线扫动（页面级）；同时修复"加载中误报空态"的正确性问题。

## 2. 设计方向（已确认）

| 场景 | 方案 |
|---|---|
| 区域加载（列表/表格/页面内容） | 沿用现有骨架屏 shimmer（`progressive-skeleton`，1.15s，`--fill-subtle`/`--fill-hover` 渐变），补齐缺口 |
| 按钮提交中 / 行内加载 | 12px `LoaderCircle` 转圈图标 + 文字（"保存中…"），图标 `currentColor` 随文字颜色；与上传浮层 `UploadTaskToast` 先例一致 |
| 页面级加载（路由切换、整页重取） | 视口顶部固定 2px 琥珀色（`var(--accent)`）细线快速扫动，加载结束随骨架屏一起消失 |
| 无障碍 | 每个新动画必须配 `prefers-reduced-motion: reduce` 关闭分支；保留 `role="status"` / 中文 aria 文案惯例 |

## 3. 现状盘点

### 3.1 基础设施

- 样式栈：`globals.css`（legacy）→ `redesign.css`（2026 设计系统，权威层）→ 页面级 CSS。token 在 `redesign.css:9-58`（`--accent` 为琥珀 `#b7791f`）。
- 骨架体系：`redesign.css:3266-3394`（`.skeleton-block`/`.skeleton` + 尺寸辅助类 + reduced-motion 分支）；组件在 `apps/web/components/system/ProgressiveLoading.tsx`（`SkeletonRows` / `TableSkeletonRows` / `RouteContentSkeleton`，带 `role="status"` + `aria-label="正在加载内容"`）。
- 路由级 loading 仅一个：`apps/web/app/app/loading.tsx` → `RouteContentSkeleton`（覆盖 `/app/*` 全部子路由导航）。
- 无 React Query / SWR / `useTransition`，加载状态全部为各客户端组件手写 `useState + useEffect`，**没有全局 pending 可以一揽子接管**，只能逐处替换。
- 转圈动画 `.spin` + `@keyframes spin` 在 4 个 admin 页面 CSS 里各自重复定义：`admin/users/users.css:237-241`、`admin/backup/backup.css:413` 附近、`admin/server-status/server-status.css:259` 附近、`admin/migration/migration.css:476` 附近。
- 无暗色模式；图标统一用 lucide-react。

### 3.2 三组现状

**A 组：已有骨架屏（表现良好，不动）** —— 论坛列表、课堂列表/详情、文件查看、通知、文库、教学、内容管理、用户管理、存储管理、服务器状态、徽章、系统设置、AI 设置、AI 助手、个人资料等约 25 处。

**B 组：纯文字加载（约 40 处，全部需要加动画）**

- 按钮类（约 25 处）：`LoginForm.tsx:161`、`AccountLinkForm.tsx:89`、`MigrationClient.tsx:474,697`、`FileEditor.tsx:1903,2220`、`ProfileClient.tsx:433,518,629`、`ImageCropDialog.tsx:300`、`NewExerciseClient.tsx:810-813`、`SubmissionsClient.tsx:338`、`AiSettingsClient.tsx:684,856`、`SystemSettingsClient.tsx:896`、`StorageBackendClient.tsx:642`、`BadgeManagementClient.tsx:425`、`ClassroomDetailClient.tsx:634,1049,1207`、`ContentClient.tsx:2098`、`BackupClient.tsx:481-483`、`MarkdownImportButton.tsx:51`、`ForumImagePicker.tsx:88`、`ForumThreadClient.tsx:948`、`TeachingEditor.tsx:328,353`、`ExerciseRunner.tsx:286,389,502`、`LogoutButton.tsx:28-30`（仅 disabled，无视觉变化）
- 行内文字类（约 11 处）：`LoginForm.tsx:96`、`TeachingPresenter.tsx:199,413,509`、`ExerciseRunner.tsx:259`、`NotificationsClient.tsx:306`、`AssetTextPreview.tsx:45`、`ContentPermissionsClient.tsx:194`、`UserManagementClient.tsx:575-577`、`ForumSettingsClient.tsx:156`、`AiAssistantClient.tsx:586-588`、以及 AI 回答等待期无"正在思考"指示（`AiAssistantClient.tsx:877-890`）

**C 组：无反馈空白 / 误报空态（约 10 处，正确性 + 动画双修）**

- `ForumThreadClient.tsx:626,959` —— 初始加载期间帖子正文区完全空白（组件内 0 处骨架）
- `ExerciseRunner.tsx:289-291` —— 加载期间题目列表空白
- `TeachingPresenter.tsx:304-306` —— deck 未加载完就误显示空态"课件暂无内容。"
- `ApiTokensClient.tsx:269-272` —— fetch 期间误显示空态"还没有令牌…"
- `BackupClient.tsx:546-550` —— fetch 期间误显示空态
- `MigrationClient.tsx:122-126` —— 包列表加载期间无任何反馈
- `SubmissionsClient.tsx:81-86,254-259` —— fetch 期间误显示"暂无提交"
- `NewExerciseClient.tsx:122-140` —— 编辑模式初始 fetch 期间表单空白
- `TeachingEditor.tsx:98-100` —— 编辑模式初始 fetch 期间编辑器空白
- `UserContributionHeatmap.tsx:158-160` —— 切换年份时旧图置灰但无新加载指示（轻）

## 4. 统一基础件设计

### 4.1 全局 CSS（加在 `redesign.css` 骨架区块之后，约 :3394）

```css
/* 转圈图标（勿用 .spin 命名——4 个 admin 页面已有同名定义，页面级会压过全局） */
.spinner-icon {
  animation: progressive-spin 0.9s linear infinite;
  color: currentColor;           /* 随按钮文字颜色，兼容 workspace 按钮重绘规则 */
}
@keyframes progressive-spin { to { transform: rotate(360deg) } }

/* 行内加载：转圈 + 文字 */
.loading-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
}

/* 页面级琥珀细线：视口顶部固定 2px，循环扫动 */
.page-progress {
  position: fixed;
  top: 0; left: 0; right: 0;
  height: 2px;
  background: var(--accent);
  z-index: 3000;
  pointer-events: none;
  animation: progressive-sweep 1.4s ease-in-out infinite;
}
@keyframes progressive-sweep {
  0%   { transform: translateX(-100%); }
  60%  { transform: translateX(30%);  }
  100% { transform: translateX(100%); }
}

/* 铁律：每个新动画配 reduced-motion 关闭分支 */
@media (prefers-reduced-motion: reduce) {
  .spinner-icon { animation: none; }
  .page-progress { animation: none; }  /* 保留静态细线，仍有反馈 */
}
```

### 4.2 新组件

```tsx
// components/system/Spinner.tsx
import { LoaderCircle } from 'lucide-react';
export function Spinner({ size = 12 }: { size?: number }) {
  return <LoaderCircle size={size} className="spinner-icon" aria-hidden="true" />;
}

// components/system/PageProgress.tsx
export function PageProgress() {
  return <div className="page-progress" role="progressbar" aria-label="正在加载页面" />;
}
```

### 4.3 扩展现有组件

`ProgressiveLoading.tsx` 增加 `FormSkeleton`（编辑模式初始 fetch 用：标题条 + 数行不同宽度文字条），C 组表单空白场景复用。

### 4.4 使用模式

按钮（B 组按钮类机械替换）：

```tsx
<button className="button secondary" disabled={saving}>
  {saving ? <Spinner size={12} /> : <SaveIcon size={14} />}
  {saving ? '保存中…' : '保存'}
</button>
```

行内（B 组行内类）：

```tsx
{loading ? <span className="loading-inline"><Spinner size={12} /> 正在加载…</span> : content}
```

空态守卫（C 组正确性修复，统一三段式）：

```tsx
if (loading) return <SkeletonRows count={N} />;
if (!items.length) return <EmptyState />;   // 只有真正取完且为空才显示空态
return <List items={items} />;
```

## 5. 分阶段实施路线

每阶段一个可独立提交的 PR，按依赖顺序：

- **Phase 0 基础件**（不改变任何页面行为）：`redesign.css` 新增上述 4 个类/keyframes；新增 `Spinner.tsx`、`PageProgress.tsx`；`ProgressiveLoading.tsx` 加 `FormSkeleton`。
- **Phase 1 按钮加载态**（约 25 处，纯机械替换，低风险）：B 组按钮类全部换成 `Spinner + 文字`，见 §3.2 清单。
- **Phase 2 行内文字加载态**（约 11 处）：B 组行内类换 `loading-inline`；补 AI 助手"正在思考"指示。
- **Phase 3 无反馈空白修复**（约 10 处）：C 组按 §4.4 三段式加骨架 + 空态守卫。
- **Phase 4 页面级细线接入**：`app/app/loading.tsx` 在 `RouteContentSkeleton` 旁加 `<PageProgress />`；`ProfileClient.tsx:368-370` 整页重取场景同步加；`messages/page.tsx:9` Suspense fallback 加。
- **Phase 5 清理**：4 个 admin 页面删本地 `.spin` 定义、迁到 `.spinner-icon`；`forum-skeleton` 硬编码 `#f2f0eb` 改为 `--fill-subtle` 变量；全站 grep 复查无遗漏纯文字加载。
- **Phase 6 全站复查**：桌面 + 移动端逐页走查（UI 评审工作流）；`prefers-reduced-motion` 审计；检查 fast load 是否闪烁（可选 polish：150ms 延迟再显示 spinner，按需取舍）。

## 6. 风险与规避

1. **`.spin` 命名冲突**：页面级 CSS 后加载、同优先级时胜出，全局定义同名 `.spin` 会被 4 个 admin 页面压过。→ 用新名 `progressive-spin`/`.spinner-icon`，Phase 5 迁移后删本地定义。
2. **workspace 按钮重绘规则**：`.workspace :is(.button,…)`（0,2,0）重设按钮背景/边框/高度，hover（0,4,0）再清一次。→ spinner 只用 `currentColor`，不设自身背景/边框/颜色，随按钮文字走。
3. **「两条细线不落十几像素内」视觉规则**：`.page-progress` 固定在 `top: 0`，需目检与壳层 header 的关系（尤其移动端 shell 行为不同），确认不与 header 边缘线冲突。
4. **纯文字按钮 `border-radius: 0` 陷阱**：给 ghost 文字按钮加 spinner 时注意不引入会裁字形的圆角容器。
5. **`RouteContentSkeleton` 被两处共用**（loading.tsx 与 ProfileClient），改动需两处都验证。
6. **骨架颜色必须用变量**：`--fill-subtle`/`--fill-hover`，禁止硬编码（`forum-skeleton` 是现存反例，Phase 5 顺手修）。
7. **登录页不在 workspace 内**：其样式上下文独立，Phase 1/2 处理 `LoginForm` 时单独确认登录页 CSS。
8. **C 组修复要保守**：只在 fetch 期间渲染骨架，不要动"加载完成"后的既有渲染路径，避免引入回归。

## 7. 验收标准

- [ ] 全站每一处异步数据加载都有视觉动画反馈：区域=骨架屏、按钮/行内=转圈+文字、页面级=琥珀细线
- [ ] 无任何"加载中误显示空态"残留（fetch 未完成时不渲染空态文案）
- [ ] 所有新动画均有 `prefers-reduced-motion: reduce` 分支
- [ ] 中文 aria 文案与 `role="status"` 惯例保持
- [ ] 桌面 + 移动端均走查通过（含 720px 断点）
- [ ] grep 确认不再有新增的重复 `.spin` 定义；无裸"正在加载/保存中"纯文字
