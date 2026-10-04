// @vitest-environment jsdom
// The recent list's Delete on 'No work recorded' entries (T-0242): shown only on deletable items, asks first,
// then DELETE /api/session/<id> and a refresh; cancelling sends nothing.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ShellHeader from "./ShellHeader";
import { RECENT_DELETE_CONFIRM } from "./RecentDelete";
import type { RecentSessions } from "./recent";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/agents", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; prefetch?: unknown }) => {
    delete rest.prefetch;
    return <a href={href} {...rest}>{children}</a>;
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const recent: RecentSessions = {
  kind: "ok",
  groups: [
    {
      label: "Today",
      items: [
        { id: "empty1", title: "No work recorded", meta: "09:00", href: "/debrief/empty1", live: false, deletable: true },
        { id: "work1", title: "Work Map · invoices", meta: "08:00", href: "/map/work1", live: false },
      ],
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  fetchMock.mockClear();
  nav.refresh.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("recent list Delete", () => {
  it("shows Delete only on deletable entries, asks, deletes and refreshes", async () => {
    act(() => root.render(<ShellHeader user={null} recent={recent} />));
    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label="Delete run"]')];
    expect(buttons).toHaveLength(1);

    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    await act(async () => buttons[0].click());
    expect(confirm).toHaveBeenCalledWith(RECENT_DELETE_CONFIRM);
    expect(fetchMock).not.toHaveBeenCalled();

    confirm.mockReturnValueOnce(true);
    await act(async () => buttons[0].click());
    expect(fetchMock).toHaveBeenCalledWith("/api/session/empty1", { method: "DELETE" });
    expect(nav.refresh).toHaveBeenCalled();
  });
});
