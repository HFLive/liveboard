import type { ContentBlock, TeachingDeckItem } from "@/lib/api";

const SLIDE_CAPACITY = 12;

export interface TeachingSlide {
  id: string;
  items: TeachingDeckItem[];
  sourceLabel: string;
  kind: "title" | "content" | "exercise";
}

function blockData(block: ContentBlock) {
  return block.dataJson &&
    typeof block.dataJson === "object" &&
    !Array.isArray(block.dataJson)
    ? (block.dataJson as Record<string, unknown>)
    : {};
}

function textValue(block: ContentBlock) {
  const text = blockData(block).text;
  return typeof text === "string" ? text : "";
}

function lineCount(text: string) {
  return Math.max(1, text.split("\n").filter((line) => line.trim()).length);
}

function estimateBlockWeight(block: ContentBlock | null) {
  if (!block) return 2;

  const data = blockData(block);
  const text = textValue(block);

  if (block.type === "image") return 8;
  if (block.type === "table") {
    const rows = Array.isArray(data.rows) ? data.rows.length : 2;
    return Math.min(9, Math.max(3, rows * 1.25));
  }
  if (block.type === "code") {
    return Math.min(9, Math.max(3, Math.ceil(lineCount(text) / 4) + 2));
  }
  if (block.type === "heading_3") return 2.5;
  if (block.type.startsWith("heading_")) return 1.5;
  if (block.type === "bulleted_list" || block.type === "numbered_list") {
    return Math.min(8, Math.max(2, lineCount(text) * 0.9));
  }
  if (block.type === "quote" || block.type === "question") {
    return Math.min(6, Math.max(2, Math.ceil(text.length / 110) + 1));
  }
  if (block.type === "math" || block.type === "reference") return 2.5;
  if (block.type === "divider") return 1;
  if (block.type === "attachment" || block.type === "todo") return 1.5;

  return Math.min(6, Math.max(1.5, Math.ceil(text.length / 140) + 0.5));
}

function isLargeHeading(item: TeachingDeckItem) {
  return (
    item.type === "content_block" &&
    (item.block?.type === "heading_1" || item.block?.type === "heading_2")
  );
}

function sourceLabel(items: TeachingDeckItem[]) {
  const sources = Array.from(
    new Set(
      items
        .map((item) =>
          item.type === "exercise"
            ? "课堂练习"
            : item.sourceFileTitle || "内容",
        )
        .filter(Boolean),
    ),
  );

  if (sources.length <= 2) return sources.join(" · ");
  return `${sources[0]} 等 ${sources.length} 个来源`;
}

export function buildTeachingSlides(items: TeachingDeckItem[]) {
  const slides: TeachingSlide[] = [];
  let pending: TeachingDeckItem[] = [];
  let pendingWeight = 0;

  function flushContent() {
    if (!pending.length) return;
    slides.push({
      id: pending[0]?.id ?? `slide-${slides.length}`,
      items: pending,
      sourceLabel: sourceLabel(pending),
      kind: "content",
    });
    pending = [];
    pendingWeight = 0;
  }

  for (const item of items) {
    if (item.type === "exercise" || isLargeHeading(item)) {
      flushContent();
      slides.push({
        id: item.id,
        items: [item],
        sourceLabel: sourceLabel([item]),
        kind: item.type === "exercise" ? "exercise" : "title",
      });
      continue;
    }

    const weight = estimateBlockWeight(item.block);
    if (pending.length && pendingWeight + weight > SLIDE_CAPACITY) {
      flushContent();
    }
    pending.push(item);
    pendingWeight += weight;
  }

  flushContent();
  return slides;
}
