import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const redesignCss = readFileSync("app/redesign.css", "utf8");
const contentCss = readFileSync("app/app/content/content.css", "utf8");
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
  });

  it("keeps the content browser to one visible pane on narrow screens", () => {
    expect(contentCss).toMatch(
      /@media \(max-width: 640px\)[\s\S]*?\.content-mobile-tabs/,
    );
    expect(contentCss).toMatch(
      /\.files-layout\.mobile-pane-tree > \.workbench-main,[\s\S]*?\.files-layout\.mobile-pane-contents > \.folder-panel\s*{[\s\S]*?display: none/,
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
