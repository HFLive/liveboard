import { describe, expect, it } from "vitest";
import type { ContentBlock, TeachingDeckItem } from "@/lib/api";
import { buildTeachingSlides } from "./teachingSlides";

function item(
  id: string,
  type: ContentBlock["type"],
  dataJson: ContentBlock["dataJson"] = { text: id },
): TeachingDeckItem {
  return {
    id,
    type: "content_block",
    sortOrder: 0,
    sourceFileId: "file-1",
    sourceBlockId: id,
    sourceFileTitle: "课程",
    block: { id, fileId: "file-1", type, sortOrder: 0, dataJson },
    exerciseSetId: null,
    exerciseTitle: null,
  };
}

function exercise(id: string): TeachingDeckItem {
  return {
    id,
    type: "exercise",
    sortOrder: 0,
    sourceFileId: null,
    sourceBlockId: null,
    sourceFileTitle: null,
    block: null,
    exerciseSetId: `exercise-${id}`,
    exerciseTitle: id,
  };
}

describe("buildTeachingSlides", () => {
  it("packs regular content blocks onto the same slide", () => {
    const slides = buildTeachingSlides([
      item("subheading", "heading_3"),
      item("paragraph", "paragraph"),
      item("list", "bulleted_list", { text: "一\n二\n三" }),
      item("quote", "quote"),
    ]);

    expect(slides).toHaveLength(1);
    expect(slides[0]?.items).toHaveLength(4);
    expect(slides[0]?.kind).toBe("content");
  });

  it("keeps level one and level two headings on their own slides", () => {
    const slides = buildTeachingSlides([
      item("intro", "paragraph"),
      item("chapter", "heading_1"),
      item("section", "heading_2"),
      item("body", "paragraph"),
    ]);

    expect(slides.map((slide) => slide.items.map((entry) => entry.id))).toEqual(
      [["intro"], ["chapter"], ["section"], ["body"]],
    );
    expect(slides.map((slide) => slide.kind)).toEqual([
      "content",
      "title",
      "title",
      "content",
    ]);
  });

  it("keeps exercises standalone", () => {
    const slides = buildTeachingSlides([
      item("before", "paragraph"),
      exercise("quiz"),
      item("after", "paragraph"),
    ]);

    expect(slides.map((slide) => slide.items.length)).toEqual([1, 1, 1]);
    expect(slides[1]?.kind).toBe("exercise");
  });

  it("splits large visual blocks when the estimated space is full", () => {
    const slides = buildTeachingSlides([
      item("image-1", "image"),
      item("image-2", "image"),
    ]);

    expect(slides).toHaveLength(2);
  });

  it("splits a long list block into consecutive slides", () => {
    const text = Array.from(
      { length: 24 },
      (_, index) => `${index + 1}. 这是一条需要完整展示的较长列表内容`,
    ).join("\n");
    const slides = buildTeachingSlides([
      item("long-list", "bulleted_list", { text }),
    ]);

    expect(slides.length).toBeGreaterThan(1);
    expect(new Set(slides.map((slide) => slide.fitGroupId))).toEqual(
      new Set(["long-list"]),
    );
    expect(
      slides
        .flatMap((slide) => slide.items)
        .map((entry) =>
          entry.block?.dataJson &&
          typeof entry.block.dataJson === "object" &&
          "text" in entry.block.dataJson
            ? entry.block.dataJson.text
            : "",
        )
        .join("\n"),
    ).toBe(text);
  });

  it("keeps numbered-list numbering continuous after pagination", () => {
    const text = Array.from(
      { length: 24 },
      (_, index) => `编号内容 ${index + 1}`,
    ).join("\n");
    const slides = buildTeachingSlides([
      item("numbered", "numbered_list", { text }),
    ]);
    const secondData = slides[1]?.items[0]?.block?.dataJson;

    expect(slides.length).toBeGreaterThan(1);
    expect(
      secondData && typeof secondData === "object" && "start" in secondData
        ? secondData.start
        : null,
    ).toBeGreaterThan(1);
  });

  it("splits a large table and repeats its header", () => {
    const rows = [
      ["名称", "说明"],
      ...Array.from({ length: 20 }, (_, index) => [
        `项目 ${index + 1}`,
        `说明 ${index + 1}`,
      ]),
    ];
    const slides = buildTeachingSlides([
      item("large-table", "table", { rows, hasHeader: true }),
    ]);

    expect(slides).toHaveLength(3);
    for (const slide of slides) {
      const data = slide.items[0]?.block?.dataJson;
      expect(
        data &&
          typeof data === "object" &&
          "rows" in data &&
          Array.isArray(data.rows)
          ? data.rows[0]
          : null,
      ).toEqual(["名称", "说明"]);
    }
  });
});
