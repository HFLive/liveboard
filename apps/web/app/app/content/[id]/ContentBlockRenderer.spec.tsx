import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("opens document images in a zoomable and rotatable viewer", () => {
    render(
      <RenderBlockContent
        block={block("image", {
          text: "线路图",
          url: "/assets/image-1",
          widthPercent: 60,
        })}
      />,
    );

    const image = screen.getByRole("button", { name: "线路图" });
    expect(image).toHaveStyle({ width: "60%" });
    fireEvent.click(image);

    expect(
      screen.getByRole("dialog", { name: "查看大图：线路图" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放大图片" }));
    expect(screen.getByLabelText("当前缩放比例")).toHaveTextContent("125%");
    const rotateButton = screen.getByRole("button", {
      name: "顺时针旋转图片",
    });
    const previewImage = screen.getAllByAltText("线路图")[1];
    fireEvent.click(rotateButton);
    expect(previewImage).toHaveStyle({
      transform: "scale(1.25) rotate(90deg)",
    });
    fireEvent.click(rotateButton);
    fireEvent.click(rotateButton);
    fireEvent.click(rotateButton);
    expect(previewImage).toHaveStyle({
      transform: "scale(1.25) rotate(360deg)",
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("renders only normalized Bilibili player embeds", () => {
    vi.stubGlobal("isSecureContext", true);
    const { rerender } = render(
      <RenderBlockContent
        block={block("bilibili", {
          embedCode:
            '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD"></iframe>',
        })}
      />,
    );
    expect(screen.getByTitle("B站视频")).toHaveAttribute(
      "src",
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&autoplay=0",
    );
    expect(screen.getByTitle("B站视频")).toHaveAttribute(
      "allow",
      "fullscreen; picture-in-picture; local-network-access; local-network; loopback-network",
    );

    rerender(
      <RenderBlockContent
        block={block("bilibili", {
          embedCode: '<iframe src="https://example.com"></iframe>',
        })}
      />,
    );
    expect(screen.queryByTitle("B站视频")).not.toBeInTheDocument();
  });

  it("links to Bilibili instead of creating an iframe on public HTTP pages", async () => {
    vi.stubGlobal("isSecureContext", false);
    render(
      <RenderBlockContent
        block={block("bilibili", {
          embedCode:
            '<iframe src="//player.bilibili.com/player.html?bvid=BV1qd3N68EjK&p=2"></iframe>',
        })}
      />,
    );

    expect(
      await screen.findByText("当前 HTTP 环境无法嵌入播放"),
    ).toBeInTheDocument();
    expect(screen.queryByTitle("B站视频")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "在 B 站打开" })).toHaveAttribute(
      "href",
      "https://www.bilibili.com/video/BV1qd3N68EjK?p=2",
    );
  });
});
