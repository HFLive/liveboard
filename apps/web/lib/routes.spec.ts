import { describe, expect, it } from "vitest";
import { appRouteTitle } from "./routes";

describe("appRouteTitle", () => {
  it("returns immediate titles for main and administration routes", () => {
    expect(appRouteTitle("/app/forum")).toBe("论坛");
    expect(appRouteTitle("/app/admin/settings")).toBe("系统设置");
  });

  it("returns generic titles while dynamic page data loads", () => {
    expect(appRouteTitle("/app/content/file-1/edit")).toBe("编辑文档");
    expect(appRouteTitle("/app/forum/thread-1")).toBe("帖子");
    expect(appRouteTitle("/app/teaching/deck-1/present")).toBe("课件展示");
  });
});
