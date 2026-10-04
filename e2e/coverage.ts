// Mechanical coverage: every visible button, a[href] and [role=button|menuitem|tab] on a screen must have an expectation.
import { expect, type Page } from "@playwright/test";

/** Visible result kinds an interactive element can produce. */
export type Result =
  | "url" // navigation: URL changes
  | "dialog" // a [role=dialog] opens
  | "live" // aria-live / status text changes
  | "download" // a download event fires
  | "disabled" // aria-disabled or disabled, with a visible reason
  | "state"; // aria-pressed / aria-selected / aria-expanded / aria-checked flips, or the page content changes

export type Inventory = Array<{ name: string; tag: string; role: string | null; href: string | null }>;

export async function inventory(page: Page, scope = "body"): Promise<Inventory> {
  return page.locator(scope).evaluate((root) => {
    const sel = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"]';
    const out: Array<{ name: string; tag: string; role: string | null; href: string | null }> = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === "hidden") continue;
      const name = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim();
      out.push({ name, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), href: el.getAttribute("href") });
    }
    return out;
  });
}

/** Fails on any visible interactive element whose accessible name matches no expectation key. */
export async function expectCovered(page: Page, expectations: Record<string, Result>, scope = "body") {
  const items = await inventory(page, scope);
  const keys = Object.keys(expectations);
  const uncovered = items.filter((i) => !keys.some((k) => (k.startsWith("/") && k.endsWith("/") ? new RegExp(k.slice(1, -1)).test(i.name) : i.name === k)));
  expect(uncovered, `uncovered interactive elements on ${page.url()}`).toEqual([]);
  return items;
}
