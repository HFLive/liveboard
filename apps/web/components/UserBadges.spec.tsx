import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserBadges } from "./UserBadges";

const badges = [
  {
    id: "badge-1",
    name: "教学认证",
    description: "已通过教学认证",
    color: "blue" as const,
  },
];

describe("UserBadges", () => {
  it("keeps the badge name in the full presentation", () => {
    render(<UserBadges badges={badges} />);

    expect(screen.getByText("教学认证")).toBeInTheDocument();
    expect(screen.getByLabelText("佩戴徽章：教学认证")).not.toHaveClass(
      "user-badges--compact",
    );
  });

  it("marks dense-list badges as icon-only while preserving their label", () => {
    render(<UserBadges badges={badges} compact />);

    expect(screen.getByLabelText("佩戴徽章：教学认证")).toHaveClass(
      "user-badges--compact",
    );
    expect(screen.getByTitle("已通过教学认证")).toBeInTheDocument();
  });
});
