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

  it.each(["paragraph", "quote", "todo", "question", "heading_3"] as const)(
    "counts newlines and blank lines when packing %s blocks",
    (type) => {
      const text = "第一行\n第二行\n\n第四行";
      const items = Array.from({ length: 4 }, (_, index) =>
        item(`multiline-${index}`, type, { text }),
      );
      const slides = buildTeachingSlides(items);

      expect(slides.length).toBeGreaterThan(1);
      expect(slides.flatMap((slide) => slide.items)).toEqual(items);
      expect(slides.every((slide) => slide.items.length <= 2)).toBe(true);
    },
  );

  it("paginates many short text lines without losing blank lines", () => {
    const text = Array.from(
      { length: 12 },
      (_, index) => `第 ${index + 1} 行`,
    ).join("\n\n");
    const slides = buildTeachingSlides([
      item("multiline-quote", "quote", { text }),
    ]);

    expect(slides.length).toBeGreaterThan(1);
    expect(
      slides
        .flatMap((slide) => slide.items)
        .map((entry) => (entry.block?.dataJson as { text: string }).text)
        .join("\n"),
    ).toBe(text);
  });

  it("accounts for multiline table headers and cells when paginating", () => {
    const header = ["表头\n\n说明"];
    const body = Array.from({ length: 4 }, (_, index) => [
      `第 ${index + 1} 项\n第二行\n\n第四行`,
    ]);
    const slides = buildTeachingSlides([
      item("multiline-table", "table", { rows: [header, ...body] }),
    ]);
    const tables = slides.map(
      (slide) => (slide.items[0]?.block?.dataJson as { rows: string[][] }).rows,
    );

    expect(slides.length).toBeGreaterThan(1);
    for (const rows of tables) expect(rows[0]).toEqual(header);
    expect(tables.flatMap((rows) => rows.slice(1))).toEqual(body);
  });

  it("keeps multiline formulas intact", () => {
    const text = `\\begin{aligned}\n${Array.from(
      { length: 12 },
      (_, index) => `x_${index} &= y \\\\`,
    ).join("\n")}\n\\end{aligned}`;
    const formula = item("formula", "math", { text });

    expect(
      buildTeachingSlides([formula]).flatMap((slide) => slide.items),
    ).toEqual([formula]);
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
