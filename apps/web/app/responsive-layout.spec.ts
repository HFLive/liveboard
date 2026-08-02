import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const redesignCss = readFileSync("app/redesign.css", "utf8");
const mobileCss = readFileSync("app/mobile.css", "utf8");
const contentCss = readFileSync("app/app/content/content.css", "utf8");
const aiCss = readFileSync("app/app/ai/ai-workspace.css", "utf8");
const libraryCss = readFileSync("app/app/library/library.css", "utf8");
const teachingCss = readFileSync("app/app/teaching/teaching.css", "utf8");
const editorCss = readFileSync(
  "app/app/content/[id]/edit/content-editor.css",
  "utf8",
);
const viewerCss = readFileSync(
  "app/app/content/[id]/content-viewer.css",
  "utf8",
);
const forumCss = readFileSync("app/app/forum/forum-clean.css", "utf8");
const classroomsCss = readFileSync("app/app/classrooms/classrooms.css", "utf8");
const assetPreviewCss = readFileSync(
  "components/asset-preview/AssetPreviewDialog.css",
  "utf8",
);
const quizBuilderCss = readFileSync(
  "app/app/exercises/new/quiz-builder.css",
  "utf8",
);
const reviewCss = readFileSync(
  "app/app/exercises/[id]/submissions/review.css",
  "utf8",
);
const adminCss = readFileSync("app/app/admin/admin.css", "utf8");

describe("responsive workspace contracts", () => {
  it("uses a top navigation and a single-column profile at mobile widths", () => {
    expect(redesignCss).toContain("grid-template-columns: minmax(0, 1fr);");
    expect(redesignCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.workspace \.profile-layout\s*{\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(redesignCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.app-rail\s*{[\s\S]*?height: 58px/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.app-main\s*{[\s\S]*?min-height: calc\(100dvh - 58px\)/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.rail-mobile-footer-row\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto/,
    );
    expect(mobileCss).toMatch(
      /\.rail-mobile-profile-avatar\s*{[\s\S]*?border: 1px solid var\(--line-strong\)/,
    );
    expect(redesignCss).toMatch(
      /\.rail-avatar\s*{[\s\S]*?border-color: var\(--line-strong\)/,
    );
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-drive-table > tbody > \.content-drive-row\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 44px/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-row-menu-button,[\s\S]*?\.history-more-button[\s\S]*?width: 44px;[\s\S]*?height: 44px/,
    );
  });

  it("prevents accidental mobile zoom without disabling pinch zoom", () => {
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?html,[\s\S]*?body\s*{\s*touch-action: manipulation/,
    );
    expect(mobileCss).toMatch(
      /textarea,[\s\S]*?select,[\s\S]*?\[contenteditable="true"\]\s*{\s*font-size: 16px !important/,
    );
    expect(mobileCss).not.toContain("user-scalable=no");
    expect(mobileCss).not.toContain("maximum-scale=1");
  });

  it("keeps management navigation reachable on narrow screens", () => {
    expect(adminCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.admin-context-nav\s*{[\s\S]*?display: flex;[\s\S]*?overflow-x: auto/,
    );
    expect(adminCss).not.toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.admin-context-nav\s*{\s*display: none/,
    );
    expect(adminCss).toContain(".admin-page--focused");
    expect(adminCss).toContain(".admin-page--standard");
    expect(adminCss).toContain(".admin-page--wide");
  });

  it("keeps the desktop management sidebar at its initial viewport offset", () => {
    expect(adminCss).toMatch(
      /\.admin-context-nav\s*{[\s\S]*?position: sticky;[\s\S]*?top: var\(--page-gutter\);[\s\S]*?align-self: start;[\s\S]*?height: calc\(100dvh - \(var\(--page-gutter\) \* 2\)\);/,
    );
  });

  it("keeps file preview dialogs the same size across workspaces", () => {
    expect(assetPreviewCss).toMatch(
      /\.workspace \.modal-panel\.asset-preview-dialog--image\s*{\s*width: min\(860px, calc\(100vw - 28px\)\)/,
    );
    expect(assetPreviewCss).toMatch(
      /\.workspace \.modal-panel\.asset-preview-dialog--document\s*{\s*width: min\(960px, calc\(100vw - 28px\)\)/,
    );
    expect(assetPreviewCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace[\s\S]*?\.modal-backdrop:has\(\.modal-panel\.asset-preview-dialog\)\s*{[\s\S]*?place-items: center;[\s\S]*?padding: 12px/,
    );
    expect(assetPreviewCss).toMatch(
      /\.workspace \.modal-panel\.asset-preview-dialog--image,[\s\S]*?\.workspace \.modal-panel\.asset-preview-dialog--document\s*{[\s\S]*?height: min\(88dvh, 860px\)/,
    );
  });

  it("uses a single directory flow for the content browser on narrow screens", () => {
    expect(contentCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.content-drive-sidebar\s*{\s*display: none/,
    );
    expect(contentCss).not.toContain("content-mobile-tabs");
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-drive-location \.breadcrumb\s*{[\s\S]*?overflow: visible/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-location \.breadcrumb\s*{[\s\S]*?flex-wrap: nowrap;[\s\S]*?overflow: visible/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-tree \.tree-label > span:last-child\s*{[\s\S]*?text-overflow: ellipsis;[\s\S]*?white-space: nowrap/,
    );
    expect(contentCss).toMatch(
      /\.content-breadcrumb-overflow-menu\s*{[\s\S]*?padding: 10px/,
    );
    expect(contentCss).toMatch(
      /\.workspace\.content-workspace \.content-breadcrumb-overflow-menu button\s*{[\s\S]*?min-height: 38px;[\s\S]*?padding: 0 12px/,
    );
    expect(contentCss).toMatch(
      /\.content-breadcrumb-label\s*{[\s\S]*?line-height: 1\.45;[\s\S]*?padding-block: 1px/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-toolbar\s*{[\s\S]*?border-bottom: 0/,
    );
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-drive-table > tbody > \.content-drive-row\s*{[\s\S]*?background: var\(--bg\);[\s\S]*?border-bottom: 1px solid var\(--line\)/,
    );
  });

  it("keeps the desktop document list readable on wide displays", () => {
    expect(contentCss).toMatch(
      /\.content-drive-layout\s*{[\s\S]*?grid-template-columns: 232px minmax\(0, 1fr\)/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-main\s*{[\s\S]*?max-width: 1180px/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-sidebar\s*{[\s\S]*?height: calc\(100dvh - \(var\(--page-gutter\) \* 2\)\)/,
    );
  });

  it("keeps mobile actions compact instead of forcing one button per row", () => {
    expect(mobileCss).toMatch(
      /\.workspace :is\(\.button, \.button\.secondary, \.button\.danger\)\s*{[\s\S]*?width: auto/,
    );
    expect(mobileCss).toMatch(
      /\.workspace \.button\.mobile-icon-action,[\s\S]*?\.workspace \.button\.danger\.mobile-icon-action\s*{[\s\S]*?width: 44px;[\s\S]*?min-height: 44px;[\s\S]*?font-size: 0/,
    );
    expect(mobileCss).toMatch(
      /\.workspace \.button\.mobile-icon-action,[\s\S]*?background: transparent;[\s\S]*?color: var\(--text-soft\);[\s\S]*?box-shadow: none/,
    );
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-drive-actions\s*{[\s\S]*?width: 100%;[\s\S]*?margin-left: 0/,
    );
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-drive-upload,[\s\S]*?\.content-create-button\s*{[\s\S]*?flex: 0 0 40px;[\s\S]*?width: 40px/,
    );
    expect(contentCss).toMatch(
      /\.content-drive-actions \.new-content-menu\s*{\s*margin-left: auto/,
    );
    expect(contentCss).toMatch(
      /\.content-create-button\s*{[\s\S]*?background: var\(--text\)/,
    );
  });

  it("keeps mobile row menus inside the viewport", () => {
    expect(redesignCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.editor-more-menu > \.context-menu\s*{[\s\S]*?top: auto;[\s\S]*?right: 0;[\s\S]*?bottom: calc\(100% \+ 6px\);[\s\S]*?left: auto;[\s\S]*?max-width: min\(220px, calc\(100vw - 24px\)\);[\s\S]*?max-height: calc\(100dvh - 88px\)/,
    );
  });

  it("exposes compact mobile entry points for enabled editors", () => {
    expect(viewerCss).toMatch(
      /@media \(max-width: 720px\)[\s\S]*?\.workspace\.content-viewer \.content-viewer-edit-link\s*{[\s\S]*?display: inline-grid;[\s\S]*?width: 42px;[\s\S]*?height: 42px/,
    );
    expect(viewerCss).toMatch(
      /\.workspace\.content-viewer \.content-viewer-edit-link > span\s*{\s*display: none/,
    );
    expect(mobileCss).not.toMatch(
      /\.teaching-list-panel \.list-toolbar > \.button,[\s\S]*?\.exercises-workspace \.exercise-toolbar-actions > \.button\s*{\s*display: none/,
    );
  });

  it("ships distinct reader fonts instead of relying on mobile system fonts", () => {
    expect(viewerCss).toContain('"Noto Serif SC"');
    expect(viewerCss).toContain('"LXGW WenKai Lite"');
    expect(viewerCss).toMatch(
      /\.content-viewer-document[\s\S]*?\.render-paragraph,[\s\S]*?font-family: inherit/,
    );
  });

  it("keeps forum compose actions together on one mobile row", () => {
    expect(forumCss).toMatch(
      /\.forum-new-actions\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto auto/,
    );
    expect(forumCss).toMatch(
      /\.forum-new-actions \.button\.secondary\s*{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1;[\s\S]*?width: auto/,
    );
  });

  it("places classroom search and its primary action on the same mobile row", () => {
    expect(classroomsCss).toMatch(/\.classrooms-workspace\s*{[\s\S]*?gap: 0/);
    expect(classroomsCss).toMatch(
      /\.workspace \.classrooms-toolbar\s*{[\s\S]*?padding-bottom: 8px/,
    );
    expect(classroomsCss).toMatch(
      /\.classrooms-toolbar \.search-field\s*{[\s\S]*?grid-column: 1;[\s\S]*?grid-row: 1/,
    );
    expect(classroomsCss).toMatch(
      /\.classrooms-toolbar > \.mobile-icon-action\s*{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1/,
    );
    expect(classroomsCss).toMatch(
      /\.classroom-content-toolbar > \.mobile-icon-action\s*{[\s\S]*?grid-column: 2;[\s\S]*?grid-row: 1/,
    );
    expect(classroomsCss).toMatch(/\.classroom-list\s*{[\s\S]*?padding-top: 0/);
    expect(classroomsCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.classroom-detail-head\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?align-items: center/,
    );
    expect(classroomsCss).toMatch(
      /\.classroom-resource-link\s*{[\s\S]*?padding: 1px 2px;[\s\S]*?max-width: calc\(100% \+ 4px\);[\s\S]*?line-height: 1\.4/,
    );
  });

  it("keeps desktop row menus large enough to target reliably", () => {
    expect(contentCss).toMatch(
      /\.content-row-menu-button\s*{[\s\S]*?width: 36px;[\s\S]*?height: 36px/,
    );
    expect(redesignCss).toMatch(
      /\.workspace[\s\S]*?:is\([\s\S]*?\.content-row-menu-button,[\s\S]*?\.history-more-button,[\s\S]*?\.row-more-button[\s\S]*?\)\s*{[\s\S]*?width: 36px;[\s\S]*?height: 36px/,
    );
    expect(redesignCss).toMatch(
      /:is\(\.content-row-menu-button, \.row-more-button\)\.icon-button\.subtle\s*{[\s\S]*?width: 36px;[\s\S]*?height: 36px/,
    );
    expect(aiCss).toMatch(
      /\.ai-workspace \.history-item\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 36px/,
    );
  });

  it("lets the file detail action menu expand upward at every viewport", () => {
    expect(redesignCss).toMatch(
      /\.asset-detail-menu > \.context-menu\s*{[\s\S]*?top: auto;[\s\S]*?bottom: calc\(100% \+ 6px\)/,
    );
  });

  it("aligns desktop file details with the preview without widening the panel", () => {
    expect(libraryCss).toMatch(
      /\.workspace\.library-workspace \.asset-detail-panel\s*{[\s\S]*?width: min\(360px, calc\(100vw - 40px\)\)/,
    );
    expect(libraryCss).toMatch(
      /@media \(min-width: 761px\)[\s\S]*?\.workspace\.library-workspace \.asset-detail-body\s*{[\s\S]*?padding-inline: 0/,
    );
  });

  it("keeps file-library mobile controls compact and list rows aligned", () => {
    expect(mobileCss).toMatch(
      /\.library-workspace \.library-layout \.list-toolbar \.toolbar-row\s*{[\s\S]*?display: flex;[\s\S]*?flex-wrap: nowrap;[\s\S]*?width: 100%/,
    );
    expect(mobileCss).toMatch(
      /\.library-workspace \.library-layout \.library-view-toggle\s*{[\s\S]*?grid-column: auto;[\s\S]*?width: auto;[\s\S]*?height: 44px/,
    );
    expect(mobileCss).toMatch(
      /\.library-workspace \.asset-list-row\s*{[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\) 24px;[\s\S]*?min-height: 56px/,
    );
  });

  it("uses one focused editor pane at a time on mobile", () => {
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.mobile-editor-pane-switch\s*{[\s\S]*?display: flex;[\s\S]*?justify-content: flex-start/,
    );
    expect(teachingCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.teaching-editor-split > \.editor-pane:not\(\.mobile-pane-active\)\s*{[\s\S]*?display: none/,
    );
    expect(teachingCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.teaching-item-row\s*{[\s\S]*?grid-template-columns: 24px minmax\(0, 1fr\) auto;[\s\S]*?min-height: 52px/,
    );
    expect(teachingCss).toMatch(
      /\.teaching-item-actions\s*{[\s\S]*?grid-column: 3;[\s\S]*?grid-row: 1/,
    );
    expect(teachingCss).toMatch(
      /\.teaching-editor-workspace \.teaching-save-label\s*{[\s\S]*?display: none/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-editor-workspace[\s\S]*?\.editor-pane:not\(\.mobile-pane-active\)\s*{[\s\S]*?display: none/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-editor-workspace \.editor-outline\s*{\s*padding-inline: 14px/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-editor-workspace \.editor-more-menu \.context-menu\s*{[\s\S]*?position: absolute;[\s\S]*?top: calc\(100% \+ 6px\);[\s\S]*?right: 0;[\s\S]*?bottom: auto;[\s\S]*?left: auto/,
    );
    expect(quizBuilderCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.quiz-builder-split > \.editor-pane:not\(\.mobile-pane-active\)\s*{[\s\S]*?display: none/,
    );
    expect(reviewCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.review-workspace[\s\S]*?:not\(\.mobile-pane-active\)\s*{[\s\S]*?display: none/,
    );
  });
});
