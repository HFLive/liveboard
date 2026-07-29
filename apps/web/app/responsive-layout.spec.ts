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
      /@media \(max-width: 760px\)[\s\S]*?\.content-workspace \.content-items-table tbody tr\s*{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) 44px/,
    );
    expect(mobileCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-row-menu-button,[\s\S]*?\.history-more-button[\s\S]*?width: 44px;[\s\S]*?height: 44px/,
    );
  });

  it("keeps the content browser to one visible pane on narrow screens", () => {
    expect(contentCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.content-mobile-tabs/,
    );
    expect(contentCss).toMatch(
      /\.files-layout\.mobile-pane-tree > \.workbench-main,[\s\S]*?\.files-layout\.mobile-pane-contents > \.folder-panel\s*{[\s\S]*?display: none/,
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
    expect(mobileCss).toMatch(
      /\.content-workspace \.content-path-head > \.content-action-bar\s*{[\s\S]*?grid-row: 1;[\s\S]*?display: flex;[\s\S]*?width: 100%;[\s\S]*?overflow: visible;[\s\S]*?background: transparent/,
    );
    expect(mobileCss).toMatch(
      /\.content-workspace \.breadcrumb\s*{[\s\S]*?grid-row: 2/,
    );
    expect(mobileCss).toMatch(
      /\.content-workspace \.content-action-bar > \.new-content-menu\s*{[\s\S]*?margin-left: auto/,
    );
    expect(mobileCss).not.toMatch(
      /\.content-workspace[\s\S]*?\.new-content-menu[\s\S]*?background: var\(--text\)/,
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

  it("keeps teaching and document editing in a readable single column", () => {
    expect(teachingCss).toMatch(
      /@media \(max-width: 1080px\)[\s\S]*?\.teaching-editor-split[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.editor-split[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    );
  });
});
