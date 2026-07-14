import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/lib/api";
import {
  DocumentPreview,
  RichTextBlockEditor,
  TableBlockEditor,
} from "./FileEditor";

const paragraph = {
  id: "block-1",
  fileId: "file-1",
  type: "paragraph",
  sortOrder: 10,
  dataJson: { text: "选中文字", inlineFormat: "markdown" },
} as ContentBlock;

describe("FileEditor structured controls", () => {
  it("renders the complete document in the separate format preview", () => {
    render(
      <DocumentPreview
        blocks={[
          paragraph,
          {
            ...paragraph,
            id: "math-1",
            type: "math",
            dataJson: { text: "x^2", display: true },
          } as ContentBlock,
        ]}
        title="预览文档"
      />,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "预览文档" }),
    ).toBeInTheDocument();
    expect(screen.getByText("选中文字")).toBeInTheDocument();
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("wraps the selected text from the rich-text toolbar", () => {
    const onChange = vi.fn();
    render(
      <RichTextBlockEditor
        block={paragraph}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 2);
    fireEvent.click(screen.getByRole("button", { name: /加粗/ }));
    expect(onChange).toHaveBeenCalledWith("**选中**文字");
  });

  it("adds rows and edits cells in the table grid", () => {
    const onChange = vi.fn();
    const table = {
      ...paragraph,
      type: "table",
      dataJson: {
        rows: [
          ["名称", "值"],
          ["面积", "1"],
        ],
        hasHeader: true,
      },
    } as ContentBlock;
    render(
      <TableBlockEditor block={table} onChange={onChange} onSave={vi.fn()} />,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "第 2 行第 2 列" }), {
      target: { value: "2" },
    });
    expect(onChange).toHaveBeenCalledWith([
      ["名称", "值"],
      ["面积", "2"],
    ]);
    fireEvent.click(screen.getByRole("button", { name: "添加行" }));
    expect(onChange).toHaveBeenCalledWith([
      ["名称", "值"],
      ["面积", "1"],
      ["", ""],
    ]);
  });
});
