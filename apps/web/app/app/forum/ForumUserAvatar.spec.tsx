import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ForumUserAvatar } from "./ForumUserAvatar";

describe("ForumUserAvatar", () => {
  it("renders the API avatar when the user has one", () => {
    const { container } = render(
      <ForumUserAvatar
        className="forum-topic-avatar"
        user={{
          avatarUrl: "/auth/avatar/user-1?v=1",
          displayName: "张老师",
        }}
      />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "http://localhost:4000/auth/avatar/user-1?v=1",
    );
  });

  it("falls back to the display-name initial", () => {
    const { container } = render(
      <ForumUserAvatar
        className="forum-comment-avatar"
        user={{ avatarUrl: null, displayName: " Admin " }}
      />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span")).toHaveTextContent("A");
  });
});
