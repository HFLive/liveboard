import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ContentBlock } from "@/lib/api";
import { RenderBlockContent, buildBlockData } from "./ContentBlockRenderer";

function block(type: ContentBlock["type"], dataJson: ContentBlock["dataJson"]) {
  return {
    id: type,
    fileId: "file-1",
    type,
    sortOrder: 10,
    dataJson,
  } as ContentBlock;
}

describe("ContentBlockRenderer", () => {
  it("renders native fourth through sixth level headings", () => {
    const { rerender } = render(
      <RenderBlockContent block={block("heading_4", { text: "四级" })} />,
    );
    expect(
      screen.getByRole("heading", { level: 4, name: "四级" }),
    ).toBeInTheDocument();
    rerender(
      <RenderBlockContent block={block("heading_6", { text: "六级" })} />,
    );
    expect(
      screen.getByRole("heading", { level: 6, name: "六级" }),
    ).toBeInTheDocument();
  });

  it("renders table cells with rich text and initializes structured blocks", () => {
    render(
      <RenderBlockContent
        block={block("table", {
          rows: [
            ["名称", "值"],
            ["**面积**", "$a^2$"],
          ],
          hasHeader: true,
        })}
      />,
    );
    expect(
      screen.getByRole("columnheader", { name: "名称" }),
    ).toBeInTheDocument();
    expect(screen.getByText("面积").tagName).toBe("STRONG");
    expect(document.querySelector(".katex")).not.toBeNull();
    expect(buildBlockData("table", "")).toEqual({
      rows: [
        ["列 1", "列 2"],
        ["", ""],
      ],
      hasHeader: true,
    });
    expect(buildBlockData("math", "")).toEqual({
      text: "E = mc^2",
      display: true,
    });
  });
});
