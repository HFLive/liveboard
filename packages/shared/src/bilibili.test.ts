import { describe, expect, it } from "vitest";
import { normalizeBilibiliEmbedUrl } from "./bilibili";

describe("normalizeBilibiliEmbedUrl", () => {
  it("extracts a canonical player URL from iframe code", () => {
    expect(
      normalizeBilibiliEmbedUrl(
        '<iframe src="//player.bilibili.com/player.html?bvid=BV1xx411c7mD&cid=123&p=2" allowfullscreen></iframe>',
      ),
    ).toBe(
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&cid=123&p=2&autoplay=0",
    );
  });

  it("converts a standard video page URL", () => {
    expect(
      normalizeBilibiliEmbedUrl(
        "https://www.bilibili.com/video/BV1xx411c7mD?p=3",
      ),
    ).toBe(
      "https://player.bilibili.com/player.html?bvid=BV1xx411c7mD&p=3&autoplay=0",
    );
  });

  it("rejects arbitrary iframe and script sources", () => {
    expect(
      normalizeBilibiliEmbedUrl(
        '<iframe src="https://example.com/embed"></iframe>',
      ),
    ).toBeNull();
    expect(
      normalizeBilibiliEmbedUrl('<script src="https://example.com"></script>'),
    ).toBeNull();
  });
});
