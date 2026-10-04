import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createNavProgress, isRouteClick, ProgressBar, PROGRESS_DELAY_MS } from "./NavProgress";

const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
const anchor = (href: string, attrs: Record<string, string> = {}) =>
  ({ href, target: attrs.target ?? "", hasAttribute: (n: string) => n in attrs }) as unknown as HTMLAnchorElement;

describe("navigation progress bar", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows nothing for a navigation shorter than 200 ms", () => {
    const onVisible = vi.fn();
    const p = createNavProgress(onVisible);
    p.start();
    vi.advanceTimersByTime(PROGRESS_DELAY_MS - 1);
    p.done();
    vi.advanceTimersByTime(1000);
    expect(onVisible).not.toHaveBeenCalled();
  });

  it("appears after 200 ms and hides when the navigation lands", () => {
    const onVisible = vi.fn();
    const p = createNavProgress(onVisible);
    p.start();
    vi.advanceTimersByTime(PROGRESS_DELAY_MS - 1);
    expect(onVisible).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onVisible).toHaveBeenLastCalledWith(true);
    p.done();
    expect(onVisible).toHaveBeenLastCalledWith(false);
  });

  it("renders a 2 px accent bar only when visible", () => {
    expect(renderToStaticMarkup(<ProgressBar visible={false} />)).toBe("");
    const html = renderToStaticMarkup(<ProgressBar visible />);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("height:2px");
    expect(html).toContain("var(--ac)");
  });

  it("starts only for internal route links, never for shallow switches, new tabs or downloads", () => {
    const here = new URL("https://app.test/agents/a");
    expect(isRouteClick(click, anchor("https://app.test/map/1"), here)).toBe(true);
    expect(isRouteClick(click, anchor("https://app.test/agents/a?tab=shortcuts", { "data-shallow": "" }), here)).toBe(false);
    expect(isRouteClick(click, anchor("https://app.test/agents/a"), here)).toBe(false);
    expect(isRouteClick({ ...click, metaKey: true }, anchor("https://app.test/map/1"), here)).toBe(false);
    expect(isRouteClick(click, anchor("https://app.test/api/export", { download: "" }), here)).toBe(false);
    expect(isRouteClick(click, anchor("https://other.test/x"), here)).toBe(false);
  });
});
