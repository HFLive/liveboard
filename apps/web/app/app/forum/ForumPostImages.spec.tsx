import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForumPostImages } from "./ForumPostImages";

const images = [
  {
    id: "image-1",
    url: "/assets/image-1",
    width: 1600,
    height: 900,
    sortOrder: 0,
  },
  {
    id: "image-2",
    url: "/assets/image-2",
    width: 900,
    height: 1600,
    sortOrder: 1,
  },
];

describe("ForumPostImages", () => {
  it("opens a lightbox and supports image navigation", () => {
    render(<ForumPostImages images={images} />);

    fireEvent.click(screen.getByRole("button", { name: "展开第 1 张图片" }));
    expect(
      screen.getByRole("dialog", { name: "图片预览" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1/2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一张" }));
    expect(screen.getByText("2/2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "关闭大图" }));
    expect(
      screen.queryByRole("dialog", { name: "图片预览" }),
    ).not.toBeInTheDocument();
  });
});
