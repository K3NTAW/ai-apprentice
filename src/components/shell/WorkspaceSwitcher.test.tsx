// @vitest-environment jsdom
// Workspace switch 2/2 (T-0354): the switcher menu through the deps seam. On ok the menu closes and the page reloads
// once; on a failed or thrown fetch the menu stays open with an alert and nothing reloads.
// No polyfills needed: the Layer portal and useMenu positioning only use APIs jsdom has (getBoundingClientRect,
// innerWidth/innerHeight, pointer and resize listeners).
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Membership } from "@/lib/auth/context";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import type { MenuDeps } from "./menuActions";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: unknown }) => {
    delete rest.prefetch;
    return <a href={href} {...rest}>{children}</a>;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const memberships: Membership[] = [
  { workspaceId: "w1", name: "Bakery", role: "owner", city: "Zug" },
  { workspaceId: "w2", name: "Garage", role: "member", city: null },
];

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function setup(fetch: MenuDeps["fetch"]) {
  const reload = vi.fn();
  act(() => root.render(<WorkspaceSwitcher mode="supabase" name="Bakery" activeId="w1" memberships={memberships} deps={{ fetch, reload }} />));
  // The menu is portalled to document.body, so query the document rather than the host.
  const menu = () => document.querySelector<HTMLElement>('[role="menu"]')!;
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-label="Switch workspace"]')!;
  act(() => toggle.click());
  expect(menu().hidden).toBe(false);
  const other = [...menu().querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((b) => b.getAttribute("aria-checked") === "false")!;
  return { reload, menu, other };
}

const alertText = () => document.querySelector('[role="alert"]')?.textContent;

describe("WorkspaceSwitcher", () => {
  it("hides the menu and reloads once when the switch succeeds", async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 204, json: async () => null }));
    const { reload, menu, other } = setup(fetch);
    await act(async () => other.click());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(["/api/workspace/active", expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId: "w2" }) })]);
    expect(menu().hidden).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(alertText()).toBeUndefined();
  });

  it("keeps the menu open with an alert and no reload when the response is not ok", async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 403, json: async () => null }));
    const { reload, menu, other } = setup(fetch);
    await act(async () => other.click());
    expect(menu().hidden).toBe(false);
    expect(alertText()).toBe("Could not switch workspace.");
    expect(reload).not.toHaveBeenCalled();
  });

  it("keeps the menu open with an alert and no reload when fetch throws", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("offline");
    });
    const { reload, menu, other } = setup(fetch);
    await act(async () => other.click());
    expect(menu().hidden).toBe(false);
    expect(alertText()).toBe("Could not switch workspace.");
    expect(reload).not.toHaveBeenCalled();
  });
});
