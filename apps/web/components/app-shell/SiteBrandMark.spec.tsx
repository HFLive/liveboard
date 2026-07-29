import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SiteBrandMark } from "./SiteBrandMark";

describe("SiteBrandMark", () => {
  it.each(["light", "dark"] as const)(
    "uses the %s surface icon and keeps LB as the no-upload fallback",
    (tone) => {
      render(<SiteBrandMark className="test-mark" tone={tone} />);

      const fallback = screen.getByText("LB");
      const mark = fallback.parentElement;

      expect(mark).toHaveClass("site-brand-mark", "test-mark");
      expect(mark).toHaveAttribute("data-brand-tone", tone);
      expect(mark).toHaveStyle({
        backgroundImage: `var(--site-brand-icon-${tone})`,
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        backgroundSize: "contain",
      });
    },
  );
});
