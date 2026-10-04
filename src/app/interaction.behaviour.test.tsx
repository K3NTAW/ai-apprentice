// Behaviour of the controls wired or checked in the interaction audit (T-0166), one block per group.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useParams: () => ({}),
  usePathname: () => "/agents",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import AgentsHome from "@/components/agents/AgentsHome";
import AgentSettings, { canDeleteAgent, DELETE_CONFIRM } from "@/components/agents/AgentSettings";
import AppOnly from "@/components/shell/AppOnly";
import ShellHeader from "@/components/shell/ShellHeader";
import { applyTheme, currentTheme, storedTheme, THEME_KEY } from "@/components/shell/ThemeToggle";
import { groupRecent } from "@/components/shell/recent";
import { homeAction } from "@/lib/agents/home";
import { confirmThen, REMOVE_MEMBER_CONFIRM, REVOKE_INVITE_CONFIRM } from "@/lib/confirm";
import { APP_ONLY_REASON, DESKTOP_APP_HREF } from "@/lib/desktop";
import { galleryCards } from "@/components/agents/model";
import { previewAgents, previewSessions } from "@/lib/fixtures/agents";
import { auditUser } from "./__audit/routes";
import AgentPreviewPage from "./agents/preview/[id]/page";
import WorkspacePreviewPage from "./workspace/preview/page";

// Pages with the async AppShell need the streaming renderer.
const html$ = async (el: ReactElement) => new Response((await prerender(el)).prelude).text();

const cards = galleryCards(previewAgents, previewSessions);
const first = cards[0];
const other = cards[1];

describe("home chips and input controls", () => {
  const html = renderToStaticMarkup(<AgentsHome greeting="Hi" cards={cards} canCreate index={[]} />);
  it("chips go to capture with the picked agent, learn, the Work Maps and the invites", () => {
    expect(html).toContain(`href="/capture?agent=${first.id}"`);
    expect(html).toContain(`Train ${first.name}`);
    for (const h of ['href="/learn', 'href="/map"', 'href="/workspace"']) expect(html).toContain(h);
  });
  it("'+' starts a session with the picked agent and the picker lists every agent", () => {
    expect(html).toContain('data-testid="home-start"');
    expect(html).toContain(`<option value="${other.id}">${other.name}</option>`);
    expect(homeAction("start a session", [], other.id)).toMatchObject({ kind: "start", href: `/capture?agent=${other.id}` });
  });
});

describe("agent settings and export", () => {
  it("settings: rename and role form, studio link, delete for owners only behind a confirm", () => {
    const owner = renderToStaticMarkup(<AgentSettings agent={previewAgents[0]} role="owner" />);
    expect(owner).toContain(`href="/agents/${previewAgents[0].id}/studio"`);
    expect(owner).toContain("Delete agent");
    expect(renderToStaticMarkup(<AgentSettings agent={previewAgents[0]} role="expert" />)).not.toContain("Delete agent");
    expect(canDeleteAgent("expert")).toBe(false);
    expect(DELETE_CONFIRM).toMatch(/^Delete this agent\?/);
  });
  it("guardrails tab exports through the export route", async () => {
    const html = await html$(<AgentPreviewPage params={Promise.resolve({ id: "pip" })} searchParams={Promise.resolve({ tab: "guardrails" })} />);
    expect(html).toMatch(/href="\/api\/export[^"]*"[^>]*>[\s\S]*?Export guardrails/);
  });
});

describe("workspace actions", () => {
  it("remove and revoke ask first and do nothing when declined", async () => {
    const action = vi.fn(async () => true);
    expect(await confirmThen(REMOVE_MEMBER_CONFIRM, action, () => false)).toBeNull();
    expect(action).not.toHaveBeenCalled();
    expect(await confirmThen(REVOKE_INVITE_CONFIRM, action, () => true)).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("the page renders invite, revoke and remove", async () => {
    const html = await html$(<WorkspacePreviewPage />);
    for (const t of ["Invite", "Revoke", "Remove"]) expect(html).toContain(t);
  });
});

describe("user menu", () => {
  const html = renderToStaticMarkup(<ShellHeader user={auditUser} />);
  it("has account, theme toggle and sign out", () => {
    expect(html).toMatch(/<a [^>]*data-testid="menu-account"[^>]*>/);
    expect(/<a [^>]*data-testid="menu-account"[^>]*>/.exec(html)![0]).toContain('href="/workspace"');
    expect(html).toContain('data-testid="theme-toggle"');
    expect(html).toContain('action="/auth/signout"');
  });
  it("theme toggle flips data-theme and remembers it", () => {
    const attrs = new Map<string, string>();
    const doc = { documentElement: { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => void attrs.set(n, v) } };
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(currentTheme(doc, () => ({ matches: false }))).toBe("dark");
    applyTheme(doc, storage, "light");
    expect(attrs.get("data-theme")).toBe("light");
    expect(store.get(THEME_KEY)).toBe("light");
    expect(storedTheme(storage)).toBe("light");
  });
});

describe("sidebar recent sessions", () => {
  it("capture opens its Work Map or debrief, teach opens its summary", () => {
    const counts = { events: 0, transcript: 0, qa: 0 };
    const [g] = groupRecent(
      [
        { id: "c1", kind: "capture", started_at: "2026-10-04T08:00:00Z", ended_at: "2026-10-04T09:00:00Z", counts, has_workmap: true },
        { id: "c2", kind: "capture", started_at: "2026-10-04T07:00:00Z", ended_at: "2026-10-04T08:00:00Z", counts, has_workmap: false },
        { id: "t1", kind: "teach", started_at: "2026-10-04T06:00:00Z", ended_at: "2026-10-04T07:00:00Z", counts, has_workmap: false },
      ],
      new Date("2026-10-04T10:00:00Z"),
    );
    expect(g.items.map((i) => i.href)).toEqual(["/map/c1", "/debrief/c2", "/teach?session=t1"]);
  });
});

describe("browser app-only notices", () => {
  it("in a browser (and on the server): disabled with the reason and the download link", () => {
    const html = renderToStaticMarkup(<AppOnly>Pair the desktop app</AppOnly>);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain(`title="${APP_ONLY_REASON}"`);
    expect(html).toContain(`href="${DESKTOP_APP_HREF}"`);
  });
  it("inside the desktop app: the control itself", () => {
    const html = renderToStaticMarkup(
      <AppOnly inApp>
        <button type="button" onClick={() => {}}>Pair the desktop app</button>
      </AppOnly>,
    );
    expect(html).not.toContain("aria-disabled");
  });
});
