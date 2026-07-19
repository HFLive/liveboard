import type { ContentBlockType } from "@liveboard/shared";

export const MAX_MARKDOWN_SIZE_BYTES = 2 * 1024 * 1024;
export const MAX_MARKDOWN_BLOCKS = 2000;

export interface MarkdownBlockInput {
  type: ContentBlockType;
  dataJson: Record<string, unknown>;
}

export interface MarkdownParseResult {
  blocks: MarkdownBlockInput[];
  warnings: string[];
}

interface ExportableBlock {
  type: string;
  dataJson: unknown;
}

export function decodeMarkdown(buffer: Buffer) {
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(buffer)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
  } catch {
    throw new Error("Markdown 文件必须使用 UTF-8 编码");
  }
}

export function markdownTitleFromFilename(filename: string) {
  const basename = filename.split(/[\\/]/).pop() ?? "";
  const title = basename
    .replace(/\.md$/i, "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);

  return title || "未命名 Markdown";
}

export function markdownDownloadFilename(title: string) {
  const safe = title
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);

  return `${safe || "content"}.md`;
}

export function parseMarkdown(markdown: string): MarkdownParseResult {
  const lines = markdown
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  const blocks: MarkdownBlockInput[] = [];
  const warnings = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const singleLineMath = line.trim().match(/^\$\$(.+)\$\$$/);
    if (singleLineMath) {
      const expression = singleLineMath[1]?.trim() ?? "";
      if (expression.length > 50_000)
        warnings.add("数学公式超过 50000 字符，超出部分已省略");
      blocks.push({
        type: "math",
        dataJson: { text: expression.slice(0, 50_000), display: true },
      });
      index += 1;
      continue;
    }

    if (line.trim() === "$$") {
      const formula: string[] = [];
      index += 1;
      while (index < lines.length && (lines[index] ?? "").trim() !== "$$") {
        formula.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      else warnings.add("一个数学公式缺少结束标记，已按文件末尾结束");
      const expression = formula.join("\n").trim();
      if (expression.length > 50_000)
        warnings.add("数学公式超过 50000 字符，超出部分已省略");
      blocks.push({
        type: "math",
        dataJson: { text: expression.slice(0, 50_000), display: true },
      });
      continue;
    }

    const fence = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
    if (fence) {
      const marker = fence[1] ?? "```";
      const language = (fence[2] ?? "").trim().split(/\s+/)[0] ?? "";
      const code: string[] = [];
      index += 1;
      while (
        index < lines.length &&
        !new RegExp(
          `^ {0,3}${escapeRegExp(marker[0] ?? "`")}{${marker.length},}\\s*$`,
        ).test(lines[index] ?? "")
      ) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      if (index < lines.length) index += 1;
      else warnings.add("一个代码块缺少结束标记，已按文件末尾结束");
      blocks.push({
        type: "code",
        dataJson: { text: code.join("\n"), language: language || "text" },
      });
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      blocks.push({
        type: `heading_${level}` as ContentBlockType,
        dataJson: {
          text: normalizeInlineMarkdown(heading[2] ?? ""),
          inlineFormat: "markdown",
        },
      });
      index += 1;
      continue;
    }

    if (/^ {0,3}((\*|_|-)\s*){3,}$/.test(line)) {
      blocks.push({ type: "divider", dataJson: {} });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const rows = [parseTableRow(line)];
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? "")) {
        if (rows.length < 50) rows.push(parseTableRow(lines[index] ?? ""));
        else warnings.add("表格超过 50 行，超出部分已省略");
        index += 1;
      }
      const sourceWidth = Math.max(...rows.map((row) => row.length));
      const width = Math.min(20, sourceWidth);
      if (sourceWidth > 20) warnings.add("表格超过 20 列，超出部分已省略");
      blocks.push({
        type: "table",
        dataJson: {
          rows: rows.map((row) =>
            Array.from({ length: width }, (_, cellIndex) =>
              normalizeTableCell(row[cellIndex] ?? "", warnings),
            ),
          ),
          hasHeader: true,
        },
      });
      continue;
    }

    const image = line
      .trim()
      .match(/^!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)$/);
    if (image) {
      const alt = normalizeInlineMarkdown(image[1] ?? "");
      const url = image[2] ?? "";
      if (isHttpUrl(url)) {
        blocks.push({
          type: "image",
          dataJson: { text: alt, url, widthPercent: 100 },
        });
      } else {
        warnings.add(
          `图片“${alt || url || "未命名图片"}”使用相对路径或非 HTTP 地址，未导入正文`,
        );
      }
      index += 1;
      continue;
    }

    const todo = line.match(/^\s*[-+*]\s+\[([ xX])\]\s+(.+)$/);
    if (todo) {
      blocks.push({
        type: "todo",
        dataJson: {
          text: normalizeInlineMarkdown(todo[2] ?? ""),
          checked: (todo[1] ?? "").toLowerCase() === "x",
          inlineFormat: "markdown",
        },
      });
      index += 1;
      continue;
    }

    if (/^\s*[-+*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? "").match(/^(\s*)[-+*]\s+(.+)$/);
        if (!match || /^\s*[-+*]\s+\[[ xX]\]\s+/.test(lines[index] ?? ""))
          break;
        const depth = Math.floor(
          (match[1]?.replace(/\t/g, "  ").length ?? 0) / 2,
        );
        if (depth > 0) warnings.add("嵌套列表已扁平化为同级列表");
        items.push(normalizeInlineMarkdown(match[2] ?? ""));
        index += 1;
      }
      blocks.push({
        type: "bulleted_list",
        dataJson: { text: items.join("\n"), inlineFormat: "markdown" },
      });
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? "").match(/^(\s*)\d+[.)]\s+(.+)$/);
        if (!match) break;
        const depth = Math.floor(
          (match[1]?.replace(/\t/g, "  ").length ?? 0) / 2,
        );
        if (depth > 0) warnings.add("嵌套列表已扁平化为同级列表");
        items.push(normalizeInlineMarkdown(match[2] ?? ""));
        index += 1;
      }
      blocks.push({
        type: "numbered_list",
        dataJson: { text: items.join("\n"), inlineFormat: "markdown" },
      });
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? "").match(/^ {0,3}>\s?(.*)$/);
        if (!match) break;
        quote.push(normalizeInlineMarkdown(match[1] ?? ""));
        index += 1;
      }
      blocks.push({
        type: "quote",
        dataJson: { text: quote.join("\n"), inlineFormat: "markdown" },
      });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? "").trim()) {
      if (paragraph.length > 0 && startsMarkdownBlock(lines[index] ?? ""))
        break;
      paragraph.push((lines[index] ?? "").trim());
      index += 1;
    }
    blocks.push({
      type: "paragraph",
      dataJson: {
        text: normalizeInlineMarkdown(paragraph.join(" ")),
        inlineFormat: "markdown",
      },
    });
  }

  return { blocks, warnings: [...warnings] };
}

export function exportMarkdown(blocks: ExportableBlock[]) {
  return `${blocks.map(exportBlock).filter(Boolean).join("\n\n").trimEnd()}\n`;
}

function exportBlock(block: ExportableBlock) {
  const data = asData(block.dataJson);
  const text = stringField(data, "text");
  const inline =
    data.inlineFormat === "markdown"
      ? normalizeInlineMarkdown(text)
      : escapeMarkdownText(text);

  if (/^heading_[1-6]$/.test(block.type)) {
    const storedLevel = numberField(data, "markdownHeadingLevel");
    const level =
      storedLevel && storedLevel >= 1 && storedLevel <= 6
        ? storedLevel
        : Number(block.type.slice(-1));
    return `${"#".repeat(level)} ${inline}`;
  }
  if (block.type === "paragraph") return inline;
  if (block.type === "bulleted_list") {
    return text
      .split("\n")
      .map((item) => `- ${exportInlineText(item, data)}`)
      .join("\n");
  }
  if (block.type === "numbered_list") {
    return text
      .split("\n")
      .map((item, index) => `${index + 1}. ${exportInlineText(item, data)}`)
      .join("\n");
  }
  if (block.type === "todo") return `- [${data.checked ? "x" : " "}] ${inline}`;
  if (block.type === "quote") {
    return text
      .split("\n")
      .map((line) => `> ${exportInlineText(line, data)}`)
      .join("\n");
  }
  if (block.type === "code") {
    const language = stringField(data, "language").replace(
      /[^a-zA-Z0-9_+.-]/g,
      "",
    );
    const longestFence = Math.max(
      3,
      ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1),
    );
    const fence = "`".repeat(longestFence);
    return `${fence}${language === "text" ? "" : language}\n${text}\n${fence}`;
  }
  if (block.type === "divider") return "---";
  if (block.type === "math") return `$$\n${text}\n$$`;
  if (block.type === "table") {
    const rows = tableRows(data);
    const width = Math.max(1, ...rows.map((row) => row.length));
    const normalized = rows.map((row) =>
      Array.from({ length: width }, (_, index) => row[index] ?? ""),
    );
    const hasHeader = data.hasHeader !== false;
    const header = hasHeader
      ? (normalized[0] ?? Array(width).fill(""))
      : Array(width).fill("");
    const body = hasHeader ? normalized.slice(1) : normalized;
    return [
      tableMarkdownRow(header),
      tableMarkdownRow(Array(width).fill("---")),
      ...body.map(tableMarkdownRow),
    ].join("\n");
  }
  if (block.type === "image") {
    const url = safeExportUrl(stringField(data, "url"));
    return url
      ? `![${escapeMarkdownLabel(text || "图片")}](${url})`
      : `图片：${escapeMarkdownText(text) || "未命名图片"}`;
  }
  if (block.type === "attachment") {
    const filename = stringField(data, "filename") || text || "附件";
    const url = safeExportUrl(stringField(data, "url"));
    return url
      ? `[${escapeMarkdownLabel(filename)}](${url})`
      : `附件：${escapeMarkdownText(filename)}`;
  }
  if (block.type === "question") return `### 题目\n\n${inline}`;

  return `> 未识别内容块（${escapeMarkdownText(block.type)}）\n> ${inline}`;
}

export function normalizeInlineMarkdown(value: string) {
  return value
    .replace(
      /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
      (_all, label: string, url: string) =>
        `图片：${label || "未命名图片"}（${url}）`,
    )
    .replace(
      /\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g,
      (_all, label: string, url: string) =>
        isSafeLinkUrl(url)
          ? `[${label}](${url})`
          : `${label}（不安全链接：${url}）`,
    );
}

function startsMarkdownBlock(line: string) {
  return /^(?:\s*\$\$| {0,3}(?:#{1,6}\s+|>{1}\s?|`{3,}|~{3,}|((\*|_|-)\s*){3,}$)|\s*(?:[-+*]\s+|\d+[.)]\s+)|\s*!\[[^\]]*\]\([^\s)]+\)\s*$)/.test(
    line,
  );
}

function asData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "string" ? value[key] : "";
}

function numberField(value: Record<string, unknown>, key: string) {
  return typeof value[key] === "number" ? value[key] : null;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isSafeLinkUrl(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    return ["http:", "https:", "mailto:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function isTableStart(lines: string[], index: number) {
  return (
    isTableRow(lines[index] ?? "") && isTableSeparator(lines[index + 1] ?? "")
  );
}

function isTableRow(value: string) {
  return value.includes("|") && parseTableRow(value).length >= 2;
}

function isTableSeparator(value: string) {
  const cells = parseTableRow(value);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseTableRow(value: string) {
  const trimmed = value.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of trimmed) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function tableRows(data: Record<string, unknown>) {
  return Array.isArray(data.rows)
    ? data.rows
        .filter(Array.isArray)
        .map((row) => row.map((cell) => (typeof cell === "string" ? cell : "")))
    : [[""]];
}

function tableMarkdownRow(row: string[]) {
  return `| ${row.map((cell) => normalizeInlineMarkdown(cell).replace(/\|/g, "\\|")).join(" | ")} |`;
}

function normalizeTableCell(value: string, warnings: Set<string>) {
  const normalized = normalizeInlineMarkdown(value);
  if (normalized.length > 10_000)
    warnings.add("表格单元格超过 10000 字符，超出部分已省略");
  return normalized.slice(0, 10_000);
}

function exportInlineText(text: string, data: Record<string, unknown>) {
  return data.inlineFormat === "markdown"
    ? normalizeInlineMarkdown(text)
    : escapeMarkdownText(text);
}

function safeExportUrl(value: string) {
  if (value.startsWith("/") || isHttpUrl(value))
    return value.replace(/\)/g, "%29");
  return "";
}

function escapeMarkdownText(value: string) {
  return value.replace(/([\\`*_[\]<>#])/g, "\\$1");
}

function escapeMarkdownLabel(value: string) {
  return value.replace(/([\\\]])/g, "\\$1");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
