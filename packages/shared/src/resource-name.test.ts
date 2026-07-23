import { describe, expect, it } from "vitest";
import {
  getResourceNameError,
  normalizeResourceName,
  validateResourceName,
} from "./resource-name";

describe("resource names", () => {
  it("normalizes surrounding and repeated horizontal whitespace", () => {
    expect(normalizeResourceName("  第一章\t 课程介绍  ")).toBe(
      "第一章 课程介绍",
    );
  });

  it("rejects empty and path-placeholder names", () => {
    expect(getResourceNameError(" \t ", "文档名称")).toBe("文档名称不能为空");
    expect(getResourceNameError("..", "文件夹名称")).toBe("文件夹名称无效");
  });

  it("rejects control and invisible characters", () => {
    expect(getResourceNameError("第一章\n第二章", "文档名称")).toContain(
      "不能包含",
    );
    expect(getResourceNameError("课件\u200b名称", "课件名称")).toContain(
      "不能包含",
    );
  });

  it("keeps ordinary punctuation used by teaching materials", () => {
    expect(validateResourceName("C++：第一讲/概览", "文档名称")).toBe(
      "C++：第一讲/概览",
    );
  });
});
