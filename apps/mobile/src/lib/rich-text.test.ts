import { describe, expect, it } from "vitest";
import { isSafeRichTextHref } from "./rich-text";

describe("isSafeRichTextHref", () => {
  it("allows http, https, mailto and site-absolute paths", () => {
    expect(isSafeRichTextHref("/app/content/1")).toBe(true);
    expect(isSafeRichTextHref("https://example.com")).toBe(true);
    expect(isSafeRichTextHref("mailto:a@b.c")).toBe(true);
  });

  it("rejects javascript and protocol-relative urls", () => {
    expect(isSafeRichTextHref("javascript:alert(1)")).toBe(false);
    expect(isSafeRichTextHref("//evil.example")).toBe(false);
  });
});
