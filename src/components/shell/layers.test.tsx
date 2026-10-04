// @vitest-environment jsdom
// Sidebar menus and the Create workspace dialog render in the top Layer (T-0257, live e2e run 2026-10-04): a portal
// on body with position fixed and z-index LAYER_Z, so the sidebar's overflow cannot clip them and the agent cards
// cannot cover them; every control stays reachable.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LAYER_Z } from "@/components/ui/Layer";
import UserCard from "./UserCard";
import { menuPosition } from "./useMenu";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WS_A = "11111111-1111-4111-8111-111111111111";
const memberships = [
  { workspaceId: WS_A, name: "Finance Ops", role: "owner" as const, city: "Zug" },
  { workspaceId: "22222222-2222-4222-8222-222222222222", name: "Sales", role: "learner" as const, city: null },
];

let sidebar: HTMLElement;
let root: Root;

beforeEach(() => {
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  // The sidebar as in SidebarFrame: a scrolling column that would clip an absolutely positioned child.
  sidebar = document.createElement("header");
  sidebar.style.overflowY = "auto";
  document.body.appendChild(sidebar);
  root = createRoot(sidebar);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.innerHTML = "";
});

const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const click = (el: HTMLElement) => act(() => el.click());

function expectTopLayer(el: HTMLElement) {
  expect(sidebar.contains(el)).toBe(false);
  expect(el.parentElement).toBe(document.body);
  expect(el.style.position === "fixed" || el.classList.contains("fixed")).toBe(true);
  expect(Number(el.style.zIndex)).toBe(LAYER_Z);
}

describe("workspace menu and Create workspace dialog", () => {
  it("the menu opens in the top layer, outside the sidebar", () => {
    act(() => root.render(<WorkspaceSwitcher mode="supabase" name="Finance Ops" activeId={WS_A} memberships={memberships} />));
    click(button("Switch workspace"));
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="Workspaces"]')!;
    expect(menu.hidden).toBe(false);
    expectTopLayer(menu);
  });

  it("Create workspace opens a dialog above all page content with Name, City and a reachable Create button", () => {
    act(() => root.render(<WorkspaceSwitcher mode="supabase" name="Finance Ops" activeId={WS_A} memberships={memberships} />));
    click(button("Switch workspace"));
    const create = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((b) => b.textContent?.includes("Create workspace"))!;
    click(create);
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const backdrop = dialog.parentElement!;
    expectTopLayer(backdrop);
    expect(backdrop.className).toContain("inset-0");
    expect(backdrop.className).toContain("overflow-y-auto");
    expect(dialog.querySelector('input[name="name"]')).toBe(document.activeElement);
    expect(dialog.querySelector('input[name="city"]')).not.toBeNull();
    const submit = [...dialog.querySelectorAll("button")].find((b) => b.textContent === "Create")!;
    expect(submit.disabled).toBe(false);
  });
});

describe("user menu", () => {
  const user = { mode: "supabase" as const, email: "sabine.keller@example.com", role: "owner", workspaceName: "Finance Ops" };

  it("opens in the top layer with account, every theme option and sign out; a press inside keeps it open", () => {
    act(() => root.render(<UserCard user={user} />));
    click(button("Open user menu"));
    const menu = document.querySelector<HTMLElement>('[role="menu"][aria-label="User menu"]')!;
    expect(menu.hidden).toBe(false);
    expectTopLayer(menu);
    const radios = [...menu.querySelectorAll('[role="menuitemradio"]')].map((r) => r.textContent);
    expect(radios).toEqual(["Dark", "Light", "System"]);
    expect(menu.textContent).toContain("Account and workspace");
    expect(menu.textContent).toContain("Sign out");
    act(() => menu.querySelector("button")!.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.hidden).toBe(false);
    act(() => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(menu.hidden).toBe(true);
  });
});

describe("menuPosition keeps the menu next to its trigger and inside the viewport", () => {
  const card = { top: 830, bottom: 882, left: 12, right: 236 };

  it("user menu at 1440x900: right of the sidebar, bottoms aligned, fully visible", () => {
    const s = menuPosition("side", card, 280, 1440, 900);
    expect(s).toMatchObject({ position: "fixed", left: 250, bottom: 18, width: 280 });
    expect(s.left as number).toBeGreaterThanOrEqual(0);
    expect((s.left as number) + 280).toBeLessThanOrEqual(1440);
  });

  it("user menu at phone width: below the trigger, right-aligned, within the screen", () => {
    const s = menuPosition("side", { top: 12, bottom: 64, left: 300, right: 378 }, 280, 390, 844);
    expect(s).toMatchObject({ top: 72, left: 98, width: 280 });
  });

  it("workspace menu: above the row, clamped to the viewport on small screens", () => {
    const s = menuPosition("above", { top: 770, bottom: 810, left: 12, right: 236 }, 300, 1440, 900);
    expect(s).toMatchObject({ left: 12, bottom: 138, width: 300 });
    expect(menuPosition("above", { top: 500, bottom: 540, left: 12, right: 236 }, 300, 300, 600).width).toBe(276);
  });
});
