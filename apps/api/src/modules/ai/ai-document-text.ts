export function blockToText(type: string, dataJson: unknown): string {
  if (!dataJson || typeof dataJson !== "object" || Array.isArray(dataJson))
    return "";
  const data = dataJson as Record<string, unknown>;
  if (type === "table" && Array.isArray(data.rows)) {
    return data.rows
      .filter(Array.isArray)
      .map((row) => row.map((cell: unknown) => String(cell ?? "")).join(" | "))
      .join("\n");
  }
  const text =
    typeof data.text === "string"
      ? data.text
      : typeof data.filename === "string"
        ? data.filename
        : typeof data.url === "string"
          ? data.url
          : "";
  if (!text) return "";
  if (/^heading_[1-6]$/u.test(type)) return "# " + text;
  if (type === "code") return "代码：\n" + text;
  if (type === "question") return "题目：" + text;
  return text;
}
