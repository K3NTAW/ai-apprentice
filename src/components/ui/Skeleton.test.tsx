import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DelayedSkeleton, PageSkeleton, SKELETON_DELAY_CLASS } from "./Skeleton";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

describe("delayed skeleton", () => {
  it("every page skeleton goes through the delayed wrapper, sidebar placeholders too", () => {
    const html = renderToStaticMarkup(<PageSkeleton label="agent" variant="detail" />);
    expect(html.match(/data-skeleton-delay/g)).toHaveLength(2);
    expect(html).toContain("aa-skel-delay");
    expect(renderToStaticMarkup(<PageSkeleton label="map" shell={false} />).match(/data-skeleton-delay/g)).toHaveLength(1);
  });

  it("stays invisible for 400 ms, then fades in over 150 ms", () => {
    expect(renderToStaticMarkup(<DelayedSkeleton>x</DelayedSkeleton>)).toContain("aa-skel-delay");
    const rule = css.match(/\.aa-skel-delay \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("opacity: 0");
    expect(rule).toMatch(/animation: aa-skel-in 150ms \S+ 400ms forwards/);
    expect(css).toMatch(/@keyframes aa-skel-in \{ to \{ opacity: 1; \} \}/);
  });

  it("reduced motion: shown without the fade", () => {
    expect(SKELETON_DELAY_CLASS).toContain("motion-reduce:animate-none");
    expect(SKELETON_DELAY_CLASS).toContain("motion-reduce:opacity-100");
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toMatch(/\.aa-skel-delay \{ opacity: 1; \}/);
  });
});

describe("page skeleton landmark", () => {
  it("is a role=status region, never a <main> (the streamed page brings its own)", () => {
    for (const shell of [true, false]) {
      const html = renderToStaticMarkup(<PageSkeleton label="learn" variant="grid" shell={shell} />);
      expect(html).not.toContain("<main");
      expect(html).toMatch(/<div role="status" aria-busy="true"/);
    }
  });
});
