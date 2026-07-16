import type { ContentBlockType } from "@liveboard/shared";
import type { ContentBlock } from "@/lib/api";
import { MathFormula, RichText } from "./RichText";

export const blockTypeOptions: Array<{
  value: ContentBlockType;
  label: string;
}> = [
  { value: "heading_1", label: "一级标题" },
  { value: "heading_2", label: "二级标题" },
  { value: "heading_3", label: "三级标题" },
  { value: "heading_4", label: "四级标题" },
  { value: "heading_5", label: "五级标题" },
  { value: "heading_6", label: "六级标题" },
  { value: "paragraph", label: "段落" },
  { value: "bulleted_list", label: "无序列表" },
  { value: "numbered_list", label: "有序列表" },
  { value: "todo", label: "待办" },
  { value: "quote", label: "引用" },
  { value: "code", label: "代码" },
  { value: "table", label: "表格" },
  { value: "math", label: "数学公式" },
  { value: "divider", label: "分割线" },
  { value: "question", label: "题目块" },
  { value: "image", label: "插图" },
  { value: "attachment", label: "附件" },
];

export function getBlockText(block: ContentBlock): string {
  if (
    block.dataJson &&
    typeof block.dataJson === "object" &&
    "text" in block.dataJson &&
    typeof block.dataJson.text === "string"
  ) {
    return block.dataJson.text;
  }

  return "";
}

export function getBlockLabel(type: ContentBlockType) {
  return blockTypeOptions.find((item) => item.value === type)?.label ?? type;
}

export function asBlockData(
  value: ContentBlock["dataJson"],
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getBlockDataString(block: ContentBlock, key: string) {
  const data = asBlockData(block.dataJson);
  const value = data[key];

  return typeof value === "string" ? value : "";
}

export function getBlockDataNumber(block: ContentBlock, key: string) {
  const data = asBlockData(block.dataJson);
  const value = data[key];

  return typeof value === "number" ? value : null;
}

export function buildBlockData(type: ContentBlockType, text: string) {
  if (type === "code") {
    return { language: "text", text };
  }

  if (type === "divider") {
    return {};
  }

  if (type === "todo") {
    return { text, checked: false, inlineFormat: "markdown" };
  }

  if (type === "table") {
    return {
      rows: [
        ["列 1", "列 2"],
        ["", ""],
      ],
      hasHeader: true,
    };
  }

  if (type === "math") {
    return { text: text || "E = mc^2", display: true };
  }

  return { text, inlineFormat: "markdown" };
}

function lines(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

export function RenderBlockContent({ block }: { block: ContentBlock }) {
  const text = getBlockText(block);
  const data = asBlockData(block.dataJson);
  const richText = (value: string) => (
    <RichText enabled={data.inlineFormat === "markdown"} text={value} />
  );

  if (block.type === "heading_1") {
    return (
      <h1 className="render-heading-xl">{richText(text || "未命名标题")}</h1>
    );
  }

  if (block.type === "heading_2") {
    return (
      <h2 className="render-heading-lg">{richText(text || "未命名标题")}</h2>
    );
  }

  if (block.type === "heading_3") {
    return (
      <h3 className="render-heading-md">{richText(text || "未命名标题")}</h3>
    );
  }

  if (block.type === "heading_4") {
    return (
      <h4 className="render-heading-sm">{richText(text || "未命名标题")}</h4>
    );
  }

  if (block.type === "heading_5") {
    return (
      <h5 className="render-heading-xs">{richText(text || "未命名标题")}</h5>
    );
  }

  if (block.type === "heading_6") {
    return (
      <h6 className="render-heading-xxs">{richText(text || "未命名标题")}</h6>
    );
  }

  if (block.type === "bulleted_list") {
    return (
      <ul className="render-list">
        {lines(text).map((item) => (
          <li key={item}>{richText(item)}</li>
        ))}
      </ul>
    );
  }

  if (block.type === "numbered_list") {
    return (
      <ol
        className="render-list"
        start={getBlockDataNumber(block, "start") ?? undefined}
      >
        {lines(text).map((item) => (
          <li key={item}>{richText(item)}</li>
        ))}
      </ol>
    );
  }

  if (block.type === "todo") {
    return (
      <label className="render-todo">
        <input
          checked={Boolean(asBlockData(block.dataJson).checked)}
          readOnly
          type="checkbox"
        />
        <span>{richText(text || "待办事项")}</span>
      </label>
    );
  }

  if (block.type === "quote") {
    return (
      <blockquote className="render-quote">
        {richText(text || "引用内容")}
      </blockquote>
    );
  }

  if (block.type === "code") {
    return <pre className="render-code">{text}</pre>;
  }

  if (block.type === "divider") {
    return <div className="render-divider" aria-label="分割线" />;
  }

  if (block.type === "math") {
    return (
      <div className="render-math-block">
        <MathFormula display expression={text || "\\text{空公式}"} />
      </div>
    );
  }

  if (block.type === "table") {
    const rows = getTableRows(block);
    const hasHeader = data.hasHeader !== false;
    const bodyRows = hasHeader ? rows.slice(1) : rows;

    return (
      <div className="render-table-scroll">
        <table className="render-table">
          {hasHeader && rows[0] ? (
            <thead>
              <tr>
                {rows[0].map((cell, index) => (
                  <th key={index}>
                    <RichText enabled text={cell} />
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {bodyRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex}>
                    <RichText enabled text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (block.type === "image") {
    const url = getBlockDataString(block, "url");
    const widthPercent = getBlockDataNumber(block, "widthPercent");
    const imageWidth =
      widthPercent === null ? 100 : Math.max(25, Math.min(100, widthPercent));

    return url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="render-image"
        src={url}
        alt={text || "图片"}
        style={{ width: `${imageWidth}%` }}
      />
    ) : (
      <div className="render-placeholder">图片：{text || "等待上传"}</div>
    );
  }

  if (block.type === "attachment") {
    const url = getBlockDataString(block, "url");
    const filename = getBlockDataString(block, "filename") || text;

    return url ? (
      <a
        className="render-attachment"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        <strong>{filename || "附件"}</strong>
        <span>打开或下载</span>
      </a>
    ) : (
      <div className="render-placeholder">附件：{text || "等待上传"}</div>
    );
  }

  if (block.type === "question") {
    return <div className="render-question">题目：{text || "待完善题干"}</div>;
  }

  return <p className="render-paragraph">{richText(text)}</p>;
}

export function getTableRows(block: ContentBlock) {
  const value = asBlockData(block.dataJson).rows;
  if (!Array.isArray(value)) return [["", ""]];

  const rows = value
    .filter(Array.isArray)
    .map((row) => row.map((cell) => (typeof cell === "string" ? cell : "")));
  return rows.length > 0 ? rows : [["", ""]];
}
