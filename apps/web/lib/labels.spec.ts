import { beforeEach, describe, expect, it } from "vitest";
import {
  assetTypeLabel,
  fileStatusLabel,
  formatDateTime,
  getAppTimeZone,
  permissionLabel,
  questionTypeLabel,
  roleLabel,
  setAppTimeZone,
  submissionStatusLabel,
  userStatusLabel,
} from "./labels";

describe("display labels", () => {
  beforeEach(() => setAppTimeZone("Asia/Shanghai"));

  it("maps domain values to user-facing Chinese labels", () => {
    expect(roleLabel("super_admin")).toBe("最高管理员");
    expect(permissionLabel("lecturer")).toBe("可制作课件");
    expect(permissionLabel(null)).toBe("-");
    expect(fileStatusLabel("archived")).toBe("已删除");
    expect(questionTypeLabel("short_answer")).toBe("简答");
    expect(submissionStatusLabel(undefined)).toBe("未开始");
    expect(submissionStatusLabel("needs_manual_review")).toBe("待人工批改");
    expect(userStatusLabel("disabled")).toBe("已停用");
  });

  it.each([
    ["application/pdf", "lesson.pdf", "PDF 文档 / PDF"],
    ["image/png", "photo.png", "图片 / PNG"],
    ["video/mp4", "recording.mp4", "视频 / MP4"],
    ["application/octet-stream", "archive", "附件"],
  ])("describes uploaded asset types", (mime, filename, expected) => {
    expect(assetTypeLabel(mime, filename)).toBe(expected);
  });

  it("persists the selected timezone and uses it for dates", () => {
    setAppTimeZone("UTC");
    const utc = formatDateTime("2026-07-14T00:00:00.000Z");
    setAppTimeZone("Asia/Shanghai");
    const shanghai = formatDateTime("2026-07-14T00:00:00.000Z");

    expect(getAppTimeZone()).toBe("Asia/Shanghai");
    expect(window.localStorage.getItem("liveboard.timeZone")).toBe(
      "Asia/Shanghai",
    );
    expect(utc).not.toBe(shanghai);
  });

  it.each([null, undefined, "not-a-date"])(
    "uses a placeholder for invalid dates",
    (value) => {
      expect(formatDateTime(value)).toBe("-");
    },
  );
});
