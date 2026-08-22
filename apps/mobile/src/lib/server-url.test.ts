import { describe, expect, it } from "vitest";
import { isLikelyLocalHost, normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  it("adds http when the scheme is missing", () => {
    expect(normalizeServerUrl("192.168.1.8:4000")).toBe(
      "http://192.168.1.8:4000",
    );
  });

  it("strips trailing slashes and query strings", () => {
    expect(normalizeServerUrl("https://board.example.com/api///?x=1")).toBe(
      "https://board.example.com/api",
    );
  });

  it("rejects empty or non-http schemes", () => {
    expect(() => normalizeServerUrl("   ")).toThrow(/填写/);
    expect(() => normalizeServerUrl("ftp://example.com")).toThrow(/http/);
  });

  it("detects emulator-unfriendly localhost hosts", () => {
    expect(isLikelyLocalHost("http://localhost:4000")).toBe(true);
    expect(isLikelyLocalHost("http://10.0.2.2:4000")).toBe(false);
  });
});
