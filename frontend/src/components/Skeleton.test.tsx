import { render, screen } from "@testing-library/react";
import { PageLoadingSkeleton } from "@/components/Skeleton";

describe("PageLoadingSkeleton", () => {
  it("announces one busy page region and keeps placeholders decorative", () => {
    render(<PageLoadingSkeleton />);

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status", { name: "Loading page" })).toBeInTheDocument();
    expect(main.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });

  it("uses responsive widths and respects reduced-motion preferences", () => {
    render(<PageLoadingSkeleton />);

    const main = screen.getByRole("main");
    expect(main).toHaveClass("px-4");
    expect(main.querySelector('[aria-hidden="true"]')).toHaveClass("max-w-5xl");
    expect(
      main.querySelector('[aria-hidden="true"] .motion-safe\\:animate-pulse'),
    ).toBeInTheDocument();
  });
});