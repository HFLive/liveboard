import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const redesignCss = readFileSync("app/redesign.css", "utf8");
const mobileCss = readFileSync("app/mobile.css", "utf8");
const contentCss = readFileSync("app/app/content/content.css", "utf8");
const aiCss = readFileSync("app/app/ai/ai-workspace.css", "utf8");
const teachingCss = readFileSync("app/app/teaching/teaching.css", "utf8");
const editorCss = readFileSync(
  "app/app/content/[id]/edit/content-editor.css",
  "utf8",
);

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
      /@media \(max-width: 640px\)[\s\S]*?\.content-mobile-tabs/,
    );
    expect(contentCss).toMatch(
      /\.files-layout\.mobile-pane-tree > \.workbench-main,[\s\S]*?\.files-layout\.mobile-pane-contents > \.folder-panel\s*{[\s\S]*?display: none/,
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

  it("keeps teaching and document editing in a readable single column", () => {
    expect(teachingCss).toMatch(
      /@media \(max-width: 820px\)[\s\S]*?\.teaching-editor-layout[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(editorCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.editor-split[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/,
    );
  });
});
