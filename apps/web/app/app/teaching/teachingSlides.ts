import type { ContentBlock, TeachingDeckItem } from "@/lib/api";

const SLIDE_CAPACITY = 12;
const LONG_TEXT_CHAR_LIMIT = 700;
const LONG_BLOCK_UNIT_LIMIT = 11;
const TABLE_BODY_ROW_LIMIT = 9;

export interface TeachingSlide {
  id: string;
  items: TeachingDeckItem[];
  sourceLabel: string;
  kind: "title" | "content" | "exercise";
  fitGroupId?: string;
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

function cloneItemWithData(
  item: TeachingDeckItem,
  dataJson: Record<string, unknown>,
  partIndex: number,
): TeachingDeckItem {
  if (!item.block) return item;
  return {
    ...item,
    id: `${item.id}::part-${partIndex + 1}`,
    block: {
      ...item.block,
      id: `${item.block.id}::part-${partIndex + 1}`,
      dataJson,
    },
  };
}

function splitLongString(text: string, limit: number) {
  const parts: string[] = [];
  let remaining = text.trim();

  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const breakAt = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf("。"),
      window.lastIndexOf("；"),
      window.lastIndexOf(" "),
    );
    const end = breakAt >= Math.floor(limit * 0.55) ? breakAt + 1 : limit;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }

  if (remaining) parts.push(remaining);
  return parts.length ? parts : [text];
}

function splitWeightedLines(text: string) {
  const sourceLines = text.split("\n").filter((line) => line.trim());
  const chunks: string[] = [];
  let pending: string[] = [];
  let units = 0;

  for (const line of sourceLines) {
    const lineUnits = Math.max(1, Math.ceil(line.length / 80));
    if (pending.length && units + lineUnits > LONG_BLOCK_UNIT_LIMIT) {
      chunks.push(pending.join("\n"));
      pending = [];
      units = 0;
    }
    if (lineUnits > LONG_BLOCK_UNIT_LIMIT) {
      const fragments = splitLongString(line, LONG_TEXT_CHAR_LIMIT);
      for (const fragment of fragments) {
        if (pending.length) chunks.push(pending.join("\n"));
        pending = [];
        units = 0;
        chunks.push(fragment);
      }
      continue;
    }
    pending.push(line);
    units += lineUnits;
  }

  if (pending.length) chunks.push(pending.join("\n"));
  return chunks.length ? chunks : [text];
}

function expandOversizedItem(item: TeachingDeckItem) {
  const block = item.block;
  if (item.type !== "content_block" || !block) return [item];

  const data = blockData(block);
  if (block.type === "table") {
    const rows = Array.isArray(data.rows)
      ? data.rows.filter(Array.isArray)
      : [];
    const hasHeader = data.hasHeader !== false;
    const header = hasHeader && rows[0] ? [rows[0]] : [];
    const body = hasHeader ? rows.slice(1) : rows;
    if (body.length <= TABLE_BODY_ROW_LIMIT) return [item];
    const parts: TeachingDeckItem[] = [];
    for (let index = 0; index < body.length; index += TABLE_BODY_ROW_LIMIT) {
      parts.push(
        cloneItemWithData(
          item,
          {
            ...data,
            rows: [
              ...header,
              ...body.slice(index, index + TABLE_BODY_ROW_LIMIT),
            ],
          },
          parts.length,
        ),
      );
    }
    return parts;
  }

  const text = textValue(block);
  if (!text) return [item];
  const textParts =
    block.type === "bulleted_list" ||
    block.type === "numbered_list" ||
    block.type === "code"
      ? splitWeightedLines(text)
      : splitLongString(text, LONG_TEXT_CHAR_LIMIT);

  if (textParts.length <= 1) return [item];
  let listStart =
    block.type === "numbered_list" && typeof data.start === "number"
      ? data.start
      : 1;
  return textParts.map((part, index) => {
    const prepared = cloneItemWithData(
      item,
      {
        ...data,
        text: part,
        ...(block.type === "numbered_list" ? { start: listStart } : {}),
      },
      index,
    );
    if (block.type === "numbered_list") listStart += lineCount(part);
    return prepared;
  });
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
  if (block.type === "math") return 2.5;
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
            : item.sourceFileTitle || "文档",
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
    const expanded = expandOversizedItem(item);
    if (expanded.length > 1) {
      flushContent();
      for (const part of expanded) {
        slides.push({
          id: part.id,
          items: [part],
          sourceLabel: sourceLabel([part]),
          kind: "content",
          fitGroupId: item.id,
        });
      }
      continue;
    }

    const [preparedItem] = expanded;
    if (!preparedItem) continue;
    if (preparedItem.type === "exercise" || isLargeHeading(preparedItem)) {
      flushContent();
      slides.push({
        id: preparedItem.id,
        items: [preparedItem],
        sourceLabel: sourceLabel([preparedItem]),
        kind: preparedItem.type === "exercise" ? "exercise" : "title",
      });
      continue;
    }

    const weight = estimateBlockWeight(preparedItem.block);
    if (pending.length && pendingWeight + weight > SLIDE_CAPACITY) {
      flushContent();
    }
    pending.push(preparedItem);
    pendingWeight += weight;
  }

  flushContent();
  return slides;
}
