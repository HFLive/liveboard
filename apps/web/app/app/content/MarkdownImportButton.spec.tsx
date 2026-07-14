import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownImportButton } from "./MarkdownImportButton";

describe("MarkdownImportButton", () => {
  it("opens the file chooser and passes the selected Markdown file", async () => {
    let resolveImport: (() => void) | undefined;
    const pendingImport = new Promise((resolve) => {
      resolveImport = resolve;
    }) as Promise<void>;
    const onImport = vi.fn(() => pendingImport);
    render(<MarkdownImportButton onImport={onImport} />);
    const input = screen.getByLabelText("选择 Markdown 文件");
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("button", { name: "导入 Markdown" }));
    expect(clickSpy).toHaveBeenCalledTimes(1);

    const file = new File(["# 标题"], "课程.md", { type: "text/markdown" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(onImport).toHaveBeenCalledWith(file);
    expect(screen.getByRole("button", { name: "导入中" })).toBeDisabled();

    resolveImport?.();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "导入 Markdown" }),
      ).toBeEnabled(),
    );
  });

  it("disables both controls when no folder is selected", () => {
    render(<MarkdownImportButton disabled onImport={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: "导入 Markdown" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("选择 Markdown 文件")).toBeDisabled();
  });
});
