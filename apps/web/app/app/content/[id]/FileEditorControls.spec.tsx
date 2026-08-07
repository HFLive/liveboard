import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock } from "@/lib/api";
import {
  AddBlockForm,
  flattenInternalDocuments,
  RichTextBlockEditor,
  TableBlockEditor,
  WysiwygBlock,
} from "./FileEditor";

const paragraph = {
  id: "block-1",
  fileId: "file-1",
  type: "paragraph",
  sortOrder: 10,
  dataJson: { text: "选中文字", inlineFormat: "markdown" },
} as ContentBlock;

function renderWysiwygBlock(
  block: ContentBlock,
  {
    editing = false,
    internalDocuments = [],
    onRequestEdit = vi.fn(),
    onExitEdit = vi.fn(),
  }: {
    editing?: boolean;
    internalDocuments?: Parameters<typeof WysiwygBlock>[0]["internalDocuments"];
    onRequestEdit?: () => void;
    onExitEdit?: () => void;
  } = {},
) {
  render(
    <WysiwygBlock
      block={block}
      dragging={false}
      dropTarget={null}
      editing={editing}
      internalDocuments={internalDocuments}
      onDelete={vi.fn()}
      onDragEnd={vi.fn()}
      onDragOver={vi.fn()}
      onDragStart={vi.fn()}
      onDrop={vi.fn()}
      onExitEdit={onExitEdit}
      onInsertAfter={vi.fn()}
      onOpenAssetPicker={vi.fn()}
      onOpenMenu={vi.fn()}
      onPatch={vi.fn()}
      onRequestEdit={onRequestEdit}
      onSave={vi.fn()}
      onUpdateText={vi.fn()}
      onUpdateType={vi.fn()}
    />,
  );
}

describe("FileEditor structured controls", () => {
  it("renders blocks in final-document form instead of raw code", () => {
    renderWysiwygBlock({
      ...paragraph,
      dataJson: { text: "**加粗** 正文", inlineFormat: "markdown" },
    } as ContentBlock);

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    const strong = document.querySelector(".doc-block-render strong");
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe("加粗");
  });

  it("enters source editing when the rendered block is clicked", () => {
    const onRequestEdit = vi.fn();
    renderWysiwygBlock(paragraph, { onRequestEdit });

    fireEvent.click(screen.getByText("选中文字"));
    expect(onRequestEdit).toHaveBeenCalled();
  });

  it("keeps links interactive instead of entering edit mode", () => {
    const onRequestEdit = vi.fn();
    renderWysiwygBlock(
      {
        ...paragraph,
        dataJson: {
          text: "[外部](https://example.com)",
          inlineFormat: "markdown",
        },
      } as ContentBlock,
      { onRequestEdit },
    );

    fireEvent.click(screen.getByRole("link"));
    expect(onRequestEdit).not.toHaveBeenCalled();
  });

  it("shows the markdown source textarea while editing", () => {
    renderWysiwygBlock(paragraph, { editing: true });

    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).value).toBe("选中文字");
    expect(screen.getByTitle("内容块类型")).toBeInTheDocument();
  });

  it("leaves edit mode when focus moves outside the block", () => {
    const onExitEdit = vi.fn();
    renderWysiwygBlock(paragraph, { editing: true, onExitEdit });

    const textarea = screen.getByRole("textbox");
    fireEvent.blur(textarea, { relatedTarget: document.body });
    expect(onExitEdit).toHaveBeenCalled();
  });

  it("keeps editing when focus moves within the block toolbar", () => {
    const onExitEdit = vi.fn();
    renderWysiwygBlock(paragraph, { editing: true, onExitEdit });

    const textarea = screen.getByRole("textbox");
    const typeSelect = screen.getByTitle("内容块类型");
    fireEvent.blur(textarea, { relatedTarget: typeSelect });
    expect(onExitEdit).not.toHaveBeenCalled();
  });

  it("renders editor images without the zoom role", () => {
    renderWysiwygBlock({
      ...paragraph,
      type: "image",
      dataJson: {
        text: "图",
        url: "https://example.com/a.png",
        widthPercent: 100,
      },
    } as ContentBlock);

    const image = document.querySelector(".doc-block-render img");
    expect(image).not.toBeNull();
    expect(image?.getAttribute("role")).not.toBe("button");
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

  it("flattens accessible document locations", () => {
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
  });

  it("keeps editing when focus enters the internal-document overlay", () => {
    const onExitEdit = vi.fn();
    renderWysiwygBlock({ ...paragraph, type: "heading_1" } as ContentBlock, {
      editing: true,
      internalDocuments: [
        {
          id: "file-2",
          title: "课程导读",
          path: "教学资料",
          status: "published",
        },
      ],
      onExitEdit,
    });

    fireEvent.click(screen.getByRole("button", { name: /站内文档/ }));
    const searchInput = screen.getByRole("textbox", { name: "搜索站内文档" });
    // 弹层搜索框 autoFocus 夺焦后，blur 的 relatedTarget 在弹层内，
    // 不应触发退出编辑态（否则弹层宿主会随编辑态卸载、选择器瞬间消失）。
    const textarea =
      document.querySelector<HTMLTextAreaElement>(".doc-block-input");
    fireEvent.blur(textarea as HTMLTextAreaElement, {
      relatedTarget: searchInput,
    });
    expect(onExitEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("inserts a table immediately when the /table shortcut is typed", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddBlockForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "/table " },
    });
    expect(onSubmit).toHaveBeenCalledWith("table", "");
  });

  it("submits typed content when clicking outside the add-block form", () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<AddBlockForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "新段落" },
    });
    fireEvent.mouseDown(document.body);
    expect(onSubmit).toHaveBeenCalledWith("paragraph", "新段落");
  });

  it("cancels an empty add-block form when clicking outside", () => {
    const onCancel = vi.fn();
    render(<AddBlockForm onCancel={onCancel} onSubmit={vi.fn()} />);

    fireEvent.mouseDown(document.body);
    expect(onCancel).toHaveBeenCalled();
    expect(onCancel.mock.calls.length).toBeGreaterThanOrEqual(1);
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
