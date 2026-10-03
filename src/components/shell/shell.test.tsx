import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/lib/auth/context";
import type { SessionStore, SessionSummary } from "@/lib/store/types";
import { recentSessions } from "./AppShell";
import ShellHeader, { type ShellUser } from "./ShellHeader";
import { groupRecent, RECENT_LIMIT } from "./recent";

const fakeStore = vi.hoisted(() => ({
  recentSessions: vi.fn(),
  listSessions: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ getRequestContext: vi.fn() }));
vi.mock("@/lib/store", () => ({ getStore: () => fakeStore as unknown as SessionStore }));

const user: ShellUser = {
  mode: "supabase",
  workspaceName: "Finance Ops · Zug",
  email: "sabine@example.com",
  role: "owner",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  memberships: [
    { workspaceId: "11111111-1111-4111-8111-111111111111", name: "Finance Ops · Zug", role: "owner" },
    { workspaceId: "22222222-2222-4222-8222-222222222222", name: "Sales · Lugano", role: "learner" },
  ],
};

const counts = { events: 0, transcript: 0, qa: 0 };
// 2026-10-04 14:00 in Zurich (UTC+2).
const now = new Date("2026-10-04T12:00:00Z");
const sessions: SessionSummary[] = [
  { id: "s-live", kind: "capture", started_at: "2026-10-04T10:48:00Z", expert: "Sabine", counts, has_workmap: false },
  { id: "s-map", kind: "capture", started_at: "2026-10-03T15:00:00Z", ended_at: "2026-10-03T16:00:00Z", counts, has_workmap: true },
  { id: "s-teach", kind: "teach", started_at: "2026-10-03T09:00:00Z", ended_at: "2026-10-03T09:30:00Z", counts, has_workmap: false },
  { id: "s-old", kind: "capture", started_at: "2026-09-27T08:00:00Z", ended_at: "2026-09-27T09:00:00Z", counts, has_workmap: false },
];

describe("shell sidebar (Sidebar.dc.html)", () => {
  it("nav items in canvas order with icons", () => {
    const html = renderToStaticMarkup(<ShellHeader user={user} />);
    const order = ["/agents", "/learn", "/workspace", "/capture#companion"].map((h) => html.indexOf(`href="${h}"`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('aria-label="App"');
    expect(html.match(/class="ui-nav/g)?.length).toBe(4);
    expect(html).toContain("apprentice</a>");
  });

  it("recent sessions from fixture sessions, newest first, grouped Today / Yesterday / Earlier", () => {
    const groups = groupRecent(sessions, now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Earlier"]);
    expect(groups[0].items[0]).toMatchObject({ id: "s-live", title: "Capture · Sabine", meta: "live · 12:48", live: true, href: "/debrief/s-live" });
    expect(groups[1].items.map((i) => i.id)).toEqual(["s-map", "s-teach"]);
    expect(groups[1].items[0].href).toBe("/map/s-map");
    expect(groups[1].items[1].title).toBe("Teach");
    expect(groups[2].items[0].meta).toBe("2026-09-27");

    const html = renderToStaticMarkup(<ShellHeader user={user} recent={{ kind: "ok", groups }} />);
    expect(html).toContain('aria-label="Recent sessions"');
    expect(html).toContain('href="/debrief/s-live"');
    expect(html).toContain('href="/map/s-map"');
    expect(html.indexOf("Today")).toBeLessThan(html.indexOf("Yesterday"));
  });

  it("keeps only the latest capture and teach sessions", () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...sessions[3], id: `s-${i}`, started_at: `2026-09-${10 + i}T08:00:00Z` }));
    const items = groupRecent(many, now).flatMap((g) => g.items);
    expect(items).toHaveLength(RECENT_LIMIT);
    expect(items[0].id).toBe("s-9");
  });

  it("empty and error states", () => {
    expect(renderToStaticMarkup(<ShellHeader user={user} recent={{ kind: "ok", groups: [] }} />)).toContain("No sessions yet.");
    expect(renderToStaticMarkup(<ShellHeader user={user} recent={{ kind: "error" }} />)).toContain("Recent sessions are unavailable.");
  });

  it("workspace switcher lists memberships in supabase mode; local mode is a static row", () => {
    const html = renderToStaticMarkup(<ShellHeader user={user} />);
    expect(html).toContain('aria-label="Switch workspace"');
    expect(html).toContain("Sales · Lugano");
    const local = renderToStaticMarkup(<ShellHeader user={{ mode: "local", workspaceName: "local", email: null, role: "owner" }} />);
    expect(local).not.toContain('aria-label="Switch workspace"');
    expect(local).toContain("local mode");
  });

  it("user menu: sign-out in supabase mode, status line instead of pairing", () => {
    const html = renderToStaticMarkup(<ShellHeader user={user} />);
    expect(html).toContain('aria-label="Open user menu"');
    expect(html).toContain('action="/auth/signout"');
    expect(html).not.toMatch(/paired|pairing/i);
  });

  it("AppShell reads recentSessions(limit), not listSessions", async () => {
    fakeStore.recentSessions.mockResolvedValue(sessions);
    const result = await recentSessions({ workspaceId: user.workspaceId } as unknown as RequestContext, now);
    expect(fakeStore.recentSessions).toHaveBeenCalledWith(RECENT_LIMIT);
    expect(fakeStore.listSessions).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: "ok", groups: groupRecent(sessions, now) });
    fakeStore.recentSessions.mockRejectedValueOnce(new Error("down"));
    expect(await recentSessions({ workspaceId: user.workspaceId } as unknown as RequestContext, now)).toEqual({ kind: "error" });
  });

  it("no hard-coded hex colours in src/components/shell/; the live dot uses var(--rd)", () => {
    const dir = __dirname;
    for (const f of readdirSync(dir).filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))) {
      expect(readFileSync(path.join(dir, f), "utf8"), f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    }
    const html = renderToStaticMarkup(<ShellHeader user={user} recent={{ kind: "ok", groups: groupRecent(sessions, now) }} />);
    expect(html).toContain("background:var(--rd)");
  });
});
