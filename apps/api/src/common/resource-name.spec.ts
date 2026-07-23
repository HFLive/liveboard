import { BadRequestException } from "@nestjs/common";
import { requireResourceName } from "./resource-name";

describe("requireResourceName", () => {
  it("returns the shared normalized value", () => {
    expect(requireResourceName("  第一章\t简介  ", "文档名称")).toBe(
      "第一章 简介",
    );
  });

  it("maps invalid shared names to an API validation error", () => {
    expect(() => requireResourceName("课件\u200b名称", "课件名称")).toThrow(
      BadRequestException,
    );
    expect(() => requireResourceName(" \n ", "练习名称")).toThrow(
      "练习名称不能为空",
    );
  });
});
