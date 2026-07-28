import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeedbackNotice, useFeedbackNotice } from "./FeedbackNotice";

function FeedbackHarness() {
  const [notice, setNotice] = useFeedbackNotice();
  return (
    <>
      <button onClick={() => setNotice("当前文件夹中已存在同名文件")}>
        显示提示
      </button>
      <FeedbackNotice notice={notice} tone="error" />
    </>
  );
}

describe("FeedbackNotice", () => {
  it("remounts when the same message is triggered repeatedly", () => {
    render(<FeedbackHarness />);

    fireEvent.click(screen.getByRole("button", { name: "显示提示" }));
    const firstNotice = screen.getByText("当前文件夹中已存在同名文件");

    fireEvent.click(screen.getByRole("button", { name: "显示提示" }));
    const secondNotice = screen.getByText("当前文件夹中已存在同名文件");

    expect(secondNotice).not.toBe(firstNotice);
  });
});
