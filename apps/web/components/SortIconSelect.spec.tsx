import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SortIconSelect } from "./SortIconSelect";

const OPTIONS = [
  { value: "updated", label: "最近更新" },
  { value: "name", label: "名称" },
] as const;

describe("SortIconSelect", () => {
  it("keeps a labelled native select behind the icon control", () => {
    const onChange = vi.fn();

    render(
      <SortIconSelect onChange={onChange} options={OPTIONS} value="updated" />,
    );

    const select = screen.getByLabelText("排序");
    expect(select).toHaveValue("updated");
    expect(screen.getByTitle("排序：最近更新")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "name" } });
    expect(onChange).toHaveBeenCalledWith("name");
  });
});
