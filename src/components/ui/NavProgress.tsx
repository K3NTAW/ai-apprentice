"use client";

// Thin top progress bar (2 px, accent) for route navigations that take longer than 200 ms; shorter ones show nothing.
// Starts on a click on an internal link (or back/forward) and ends when the pathname or search params change.
// Shallow in-page switches (<a data-shallow>) never start it.
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export const PROGRESS_DELAY_MS = 200;
/** A navigation that never lands (error, aborted) hides the bar after this long. */
const PROGRESS_CAP_MS = 15_000;

export function createNavProgress(onVisible: (visible: boolean) => void, delay = PROGRESS_DELAY_MS, cap = PROGRESS_CAP_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  const done = () => {
    if (timer) clearTimeout(timer);
    if (capTimer) clearTimeout(capTimer);
    timer = capTimer = null;
    if (shown) {
      shown = false;
      onVisible(false);
    }
  };
  const start = () => {
    if (timer || shown) return;
    timer = setTimeout(() => {
      timer = null;
      shown = true;
      onVisible(true);
      capTimer = setTimeout(done, cap);
    }, delay);
  };
  return { start, done };
}

export function ProgressBar({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      data-nav-progress
      className="aa-nav-progress pointer-events-none fixed inset-x-0 top-0 z-50"
      style={{ height: 2, background: "var(--ac)" }}
    />
  );
}

/** True when a click on this anchor is a route navigation inside the app (not a new tab, download or shallow switch). */
export function isRouteClick(e: Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">, a: HTMLAnchorElement, here: URL): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  if (a.hasAttribute("data-shallow") || a.hasAttribute("download") || (a.target && a.target !== "_self")) return false;
  let to: URL;
  try {
    to = new URL(a.href, here);
  } catch {
    return false;
  }
  if (to.origin !== here.origin || to.pathname.startsWith("/api/")) return false;
  return to.pathname !== here.pathname || to.search !== here.search;
}

export default function NavProgress() {
  const pathname = usePathname();
  const search = useSearchParams()?.toString() ?? "";
  const [visible, setVisible] = useState(false);
  const progress = useMemo(() => createNavProgress(setVisible), []);

  useEffect(() => {
    progress.done();
  }, [pathname, search, progress]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = e.target instanceof Element ? e.target.closest("a") : null;
      if (a && isRouteClick(e, a, new URL(window.location.href))) progress.start();
    };
    const onPop = () => progress.start();
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
      progress.done();
    };
  }, [progress]);

  return <ProgressBar visible={visible} />;
}
