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
});
