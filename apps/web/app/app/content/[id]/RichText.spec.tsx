import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MathFormula, RichText, isSafeRichTextHref } from "./RichText";

describe("RichText", () => {
  it("renders supported inline formatting and safe links", () => {
    render(
      <RichText
        enabled
        text="**重点**、*强调*、~~删除~~、`代码`、[官网](https://example.com) 与 $x^2$"
      />,
    );

    expect(screen.getByText("重点").tagName).toBe("STRONG");
    expect(screen.getByText("强调").tagName).toBe("EM");
    expect(screen.getByText("删除").tagName).toBe("DEL");
    expect(screen.getByText("代码").tagName).toBe("CODE");
    expect(screen.getByRole("link", { name: "官网" })).toHaveAttribute(
      "href",
      "https://example.com",
    );
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("keeps legacy text plain and refuses executable link protocols", () => {
    const { rerender } = render(<RichText enabled={false} text="**旧内容**" />);
    expect(screen.getByText("**旧内容**").tagName).not.toBe("STRONG");

    rerender(<RichText enabled text="[危险](javascript:alert)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText(/不安全链接/)).toBeInTheDocument();
    expect(isSafeRichTextHref("/app/content")).toBe(true);
    expect(isSafeRichTextHref("//evil.example")).toBe(false);
  });

  it("renders display math without trusting external-resource commands", () => {
    const { container } = render(
      <MathFormula
        display
        expression="\\includegraphics{https://example.com/a.png}"
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });
});
