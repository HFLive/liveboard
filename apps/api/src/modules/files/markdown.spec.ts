import {
  decodeMarkdown,
  exportMarkdown,
  markdownDownloadFilename,
  markdownTitleFromFilename,
  normalizeInlineMarkdown,
  parseMarkdown,
} from "./markdown";

describe("Markdown conversion", () => {
  it("parses supported blocks and preserves safe inline formatting", () => {
    const result = parseMarkdown(`\uFEFF# **标题**

普通 *段落* 与 [链接](https://example.com)。

- 第一项
  - 子项

1. 一
2. 二

- [x] 完成

> 引用

\`\`\`ts
const value = 1;
\`\`\`

---

![示例](https://example.com/image.png)

![本地](./image.png)`);

    expect(result.blocks).toEqual([
      {
        type: "heading_1",
        dataJson: { text: "**标题**", inlineFormat: "markdown" },
      },
      {
        type: "paragraph",
        dataJson: {
          text: "普通 *段落* 与 [链接](https://example.com)。",
          inlineFormat: "markdown",
        },
      },
      {
        type: "bulleted_list",
        dataJson: { text: "第一项\n子项", inlineFormat: "markdown" },
      },
      {
        type: "numbered_list",
        dataJson: { text: "一\n二", inlineFormat: "markdown" },
      },
      {
        type: "todo",
        dataJson: { text: "完成", checked: true, inlineFormat: "markdown" },
      },
      {
        type: "quote",
        dataJson: { text: "引用", inlineFormat: "markdown" },
      },
      {
        type: "code",
        dataJson: { text: "const value = 1;", language: "ts" },
      },
      { type: "divider", dataJson: {} },
      {
        type: "image",
        dataJson: {
          text: "示例",
          url: "https://example.com/image.png",
          widthPercent: 100,
        },
      },
    ]);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "嵌套列表已扁平化为同级列表",
        "图片“本地”使用相对路径或非 HTTP 地址，未导入正文",
      ]),
    );
  });

  it("keeps heading levels 4-6 as native block types", () => {
    const parsed = parseMarkdown("#### 深层标题");

    expect(parsed.blocks).toEqual([
      {
        type: "heading_4",
        dataJson: { text: "深层标题", inlineFormat: "markdown" },
      },
    ]);
    expect(exportMarkdown(parsed.blocks)).toBe("#### 深层标题\n");
  });

  it("exports Bilibili embeds as safe links", () => {
    expect(
      exportMarkdown([
        {
          type: "bilibili",
          dataJson: {
            embedCode:
              '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>',
          },
        },
      ]),
    ).toContain(
      "[B站视频](https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0)",
    );
  });

  it("round-trips GFM tables, display math, inline math, and safe links", () => {
    const parsed = parseMarkdown(`| 名称 | 公式 |
| --- | --- |
| 面积 | $a^2$ |

$$
\\sum_{i=1}^n i
$$

[站内](/app/content) [危险](javascript:alert)`);

    expect(parsed.blocks).toEqual([
      {
        type: "table",
        dataJson: {
          rows: [
            ["名称", "公式"],
            ["面积", "$a^2$"],
          ],
          hasHeader: true,
        },
      },
      {
        type: "math",
        dataJson: { text: "\\sum_{i=1}^n i", display: true },
      },
      {
        type: "paragraph",
        dataJson: {
          text: "[站内](/app/content) 危险（不安全链接：javascript:alert）",
          inlineFormat: "markdown",
        },
      },
    ]);
    expect(exportMarkdown(parsed.blocks)).toContain("| 面积 | $a^2$ |");
    expect(exportMarkdown(parsed.blocks)).toContain("$$\n\\sum_{i=1}^n i\n$$");
  });

  it("exports every existing content block type with safe readable fallbacks", () => {
    const output = exportMarkdown([
      { type: "heading_1", dataJson: { text: "标题" } },
      { type: "paragraph", dataJson: { text: "含 * 符号" } },
      { type: "bulleted_list", dataJson: { text: "甲\n乙" } },
      { type: "numbered_list", dataJson: { text: "一\n二" } },
      { type: "todo", dataJson: { text: "完成", checked: true } },
      { type: "quote", dataJson: { text: "引用" } },
      { type: "code", dataJson: { text: "```", language: "js" } },
      { type: "divider", dataJson: {} },
      { type: "image", dataJson: { text: "图", url: "javascript:alert(1)" } },
      {
        type: "attachment",
        dataJson: { filename: "讲义.pdf", url: "/assets/asset-1" },
      },
      { type: "question", dataJson: { text: "为什么？" } },
    ]);

    expect(output).toContain("# 标题");
    expect(output).toContain("含 \\* 符号");
    expect(output).toContain("- [x] 完成");
    expect(output).toContain("````js\n```\n````");
    expect(output).toContain("图片：图");
    expect(output).not.toContain("javascript:");
    expect(output).toContain("[讲义.pdf](/assets/asset-1)");
    expect(output).toContain("### 题目\n\n为什么？");
  });

  it("handles UTF-8 BOM, rejects invalid UTF-8, and sanitizes names", () => {
    expect(decodeMarkdown(Buffer.from("\uFEFF内容\r\n", "utf8"))).toBe(
      "内容\n",
    );
    expect(() => decodeMarkdown(Buffer.from([0xc3, 0x28]))).toThrow(
      "Markdown 文件必须使用 UTF-8 编码",
    );
    expect(markdownTitleFromFilename("../课程.md")).toBe("课程");
    expect(markdownDownloadFilename("课程:第一讲/测试. ")).toBe(
      "课程-第一讲-测试.md",
    );
  });

  it("preserves safe rich text and turns inline images into readable text", () => {
    expect(
      normalizeInlineMarkdown(
        "**重点**、`代码`、[官网](https://example.com) 和 ![图](./a.png)",
      ),
    ).toBe(
      "**重点**、`代码`、[官网](https://example.com) 和 图片：图（./a.png）",
    );
  });
});
