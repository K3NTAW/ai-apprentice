// In-page switches (tabs, pickers) change the URL without a navigation: Next.js syncs native history calls with
// usePathname/useSearchParams, so there is no server render and no loading boundary.

export type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; preventDefault(): void };

/** A left click without modifiers; anything else (new tab, download) keeps the browser default. */
export const isPlainClick = (e: ClickLike) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export function shallowReplace(href: string) {
  if (typeof window !== "undefined") window.history.replaceState(null, "", href);
}

/** onClick for an <a data-shallow> whose href stays as the no-JS and new-tab fallback. */
export const shallowClick = (href: string, select: () => void) => (e: ClickLike) => {
  if (!isPlainClick(e)) return;
  e.preventDefault();
  select();
  shallowReplace(href);
};
