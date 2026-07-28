import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/lib/api";
import {
  DocumentPreview,
  flattenInternalDocuments,
  RichTextBlockEditor,
  syncScrollProgress,
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
      />,
    );

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

  it("inserts a selected internal document without asking for an external URL", () => {
    const onChange = vi.fn();
    render(
      <RichTextBlockEditor
        block={paragraph}
        internalDocuments={[
          {
            id: "file-2",
            title: "课程导读",
            path: "教学资料",
            status: "published",
          },
        ]}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 2);
    fireEvent.click(screen.getByRole("button", { name: /站内文档/ }));
    fireEvent.click(screen.getByRole("button", { name: /课程导读/ }));
    expect(onChange).toHaveBeenCalledWith("[选中](/app/content/file-2)文字");
  });

  it("keeps the original external-link action beside internal documents", () => {
    const onChange = vi.fn();
    vi.spyOn(window, "prompt").mockReturnValue("https://example.com/guide");
    render(
      <RichTextBlockEditor
        block={paragraph}
        onChange={onChange}
        onSave={vi.fn()}
      />,
    );
    const textarea = screen.getByRole("textbox");
    (textarea as HTMLTextAreaElement).setSelectionRange(0, 2);
    fireEvent.click(screen.getByRole("button", { name: /^↗? ?链接$/ }));
    expect(onChange).toHaveBeenCalledWith(
      "[选中](https://example.com/guide)文字",
    );
  });

  it("flattens accessible document locations and matches pane progress", () => {
    const documents = flattenInternalDocuments([
      {
        id: "folder-1",
        name: "课程",
        parentId: null,
        permission: "viewer",
        fileCount: 1,
        pinnedOrder: null,
        updatedAt: "2026-07-28T00:00:00.000Z",
        files: [
          {
            id: "file-2",
            folderId: "folder-1",
            title: "课程导读",
            type: "doc",
            status: "published",
            pinnedOrder: null,
            updatedAt: "2026-07-28T00:00:00.000Z",
          },
        ],
        children: [],
      },
    ]);
    expect(documents[0]).toMatchObject({
      id: "file-2",
      path: "课程",
      title: "课程导读",
    });

    const source = { scrollTop: 400, scrollHeight: 1000, clientHeight: 200 };
    const target = { scrollTop: 0, scrollHeight: 500, clientHeight: 100 };
    expect(syncScrollProgress(source, target)).toBe(0.5);
    expect(target.scrollTop).toBe(200);
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
