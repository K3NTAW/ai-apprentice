// Sidebar workspace menu and user menu (T-0190). The Vitest environment is node: markup via renderToStaticMarkup,
// the click handlers' actions via the plain functions in menuActions with a fake fetch and auth.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { workspaceLabel } from "@/lib/workspace/create";
import { createWorkspace, displayName, renameWorkspace, saveDisplayName, switchWorkspace, type MenuDeps } from "./menuActions";
import ShellHeader, { type ShellUser } from "./ShellHeader";
import { applyThemeChoice, storedChoice, THEME_KEY } from "./ThemeToggle";
import { CreateWorkspaceDialog } from "./WorkspaceSwitcher";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const user: ShellUser = {
  mode: "supabase",
  workspaceName: "Finance Ops",
  email: "sabine.keller@example.com",
  role: "owner",
  workspaceId: WS_A,
  memberships: [
    { workspaceId: WS_A, name: "Finance Ops", role: "owner", city: "Zug" },
    { workspaceId: WS_B, name: "Sales", role: "learner", city: null },
  ],
};

function deps(status = 200, body: unknown = { ok: true }) {
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>>(async () => ({ ok: status < 300, status, json: async () => body }));
  const reload = vi.fn();
  return { fetch, reload, deps: { fetch, reload } as MenuDeps };
}

describe("workspace menu", () => {
  const html = renderToStaticMarkup(<ShellHeader user={user} />);
  const menu = /<div[^>]*role="menu" aria-label="Workspaces"[\s\S]*?Workspace settings/.exec(html)?.[0] ?? "";

  it("the row shows initials, name · city and opens a closed, keyboard-reachable menu", () => {
    expect(html).toMatch(/<button[^>]*aria-label="Switch workspace"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
    expect(html).toContain(">FO</span>");
    expect(html).toContain("Finance Ops · Zug");
    expect(menu).toMatch(/hidden=""/);
  });

  it("lists the workspaces with role badges and the active one checked", () => {
    const items = [...menu.matchAll(/<button[^>]*role="menuitemradio"[^>]*aria-checked="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)];
    expect(items.map((m) => m[1])).toEqual(["true", "false"]);
    expect(items[0]![2]).toContain("Finance Ops · Zug");
    expect(items[0]![2]).toContain(">owner</span>");
    expect(items[0]![2]).toContain('data-testid="active-check"');
    expect(items[1]![2]).toContain("Sales");
    expect(items[1]![2]).toContain(">learner</span>");
    expect(items[1]![2]).not.toContain("active-check");
  });

  it("has a divider, Create workspace and Workspace settings (/workspace)", () => {
    expect(menu).toMatch(/role="menuitem"[^>]*>[\s\S]*?Create workspace/);
    expect(menu).toMatch(/<a [^>]*href="\/workspace"[^>]*role="menuitem"|<a [^>]*role="menuitem"[^>]*href="\/workspace"/);
  });

  it("a single workspace still gets the menu (to create one); local mode stays a static row", () => {
    const one = renderToStaticMarkup(<ShellHeader user={{ ...user, memberships: [user.memberships![0]!] }} />);
    expect(one).toContain('aria-label="Switch workspace"');
    expect(one).toContain("Create workspace");
    const local = renderToStaticMarkup(<ShellHeader user={{ mode: "local", workspaceName: "local", email: null, role: "owner" }} />);
    expect(local).not.toContain("Create workspace");
  });

  it("choosing a workspace POSTs /api/workspace/active and reloads; the active one does nothing", async () => {
    const d = deps();
    expect(await switchWorkspace(WS_B, WS_A, d.deps)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith("/api/workspace/active", expect.objectContaining({ method: "POST", body: JSON.stringify({ workspaceId: WS_B }) }));
    expect(d.reload).toHaveBeenCalledTimes(1);
    const same = deps();
    await switchWorkspace(WS_A, WS_A, same.deps);
    expect(same.fetch).not.toHaveBeenCalled();
    const failed = deps(403);
    expect(await switchWorkspace(WS_B, WS_A, failed.deps)).toEqual({ ok: false });
    expect(failed.reload).not.toHaveBeenCalled();
  });

  it("workspaceLabel does not repeat a city already in the name", () => {
    expect(workspaceLabel("Finance Ops", "Zug")).toBe("Finance Ops · Zug");
    expect(workspaceLabel("Finance Ops · Zug", "Zug")).toBe("Finance Ops · Zug");
    expect(workspaceLabel("Sales", null)).toBe("Sales");
  });
});

describe("Create workspace", () => {
  it("the dialog has a required name (max 60) and an optional city", () => {
    const html = renderToStaticMarkup(<CreateWorkspaceDialog onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    const name = /<input[^>]*name="name"[^>]*>/.exec(html)?.[0] ?? "";
    const city = /<input[^>]*name="city"[^>]*>/.exec(html)?.[0] ?? "";
    expect(name).toMatch(/\brequired\b/);
    expect(name).toMatch(/maxlength="60"/i);
    expect(city).not.toMatch(/\brequired\b/);
    expect(city).toMatch(/maxlength="60"/i);
    expect(html).toContain("City (optional)");
  });

  it("validates the name before sending anything", async () => {
    for (const name of ["", "   ", "x".repeat(61)]) {
      const d = deps();
      const r = await createWorkspace({ name, city: "" }, d.deps);
      expect(r.ok).toBe(false);
      expect(d.fetch).not.toHaveBeenCalled();
    }
    const d = deps();
    expect(await createWorkspace({ name: "Ops", city: "x".repeat(61) }, d.deps)).toMatchObject({ ok: false });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("POSTs /api/workspace with the trimmed name and city, then switches (reload into the new workspace)", async () => {
    const d = deps(201, { id: WS_B });
    expect(await createWorkspace({ name: "  Treasury ", city: " Zug " }, d.deps)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: "Treasury", city: "Zug" }) }));
    expect(d.reload).toHaveBeenCalledTimes(1);
    const noCity = deps(201, { id: WS_B });
    await createWorkspace({ name: "Treasury", city: "  " }, noCity.deps);
    expect(noCity.fetch.mock.calls[0]![1].body).toBe(JSON.stringify({ name: "Treasury", city: null }));
  });

  it("shows the server's refusal and stays", async () => {
    const unavailable = deps(503);
    expect(await createWorkspace({ name: "Treasury", city: "" }, unavailable.deps)).toEqual({ ok: false, error: "Workspace creation is not available yet." });
    expect(unavailable.reload).not.toHaveBeenCalled();
    expect(await createWorkspace({ name: "Treasury", city: "" }, deps(409).deps)).toEqual({ ok: false, error: "You already own 10 workspaces." });
  });
});

describe("user menu", () => {
  const html = renderToStaticMarkup(<ShellHeader user={user} />);
  const menu = /<div[^>]*role="menu" aria-label="User menu"[\s\S]*$/.exec(html)?.[0] ?? "";

  it("the card shows the capitalised address local part without a full name", () => {
    expect(displayName(null, "sabine.keller@example.com", "User")).toBe("Sabine Keller");
    expect(displayName("  Lena Muster ", "x@example.com", "User")).toBe("Lena Muster");
    expect(displayName(null, null, "User")).toBe("User");
    expect(html).toMatch(/data-testid="user-name"[^>]*>Sabine Keller<\/span>/);
    expect(html).toContain(">SK</span>");
  });

  it("Account shows the address and offers the display name edit; Theme has dark, light and system; Sign out posts", () => {
    expect(menu).toContain("sabine.keller@example.com");
    expect(menu).toContain('data-testid="edit-name"');
    const choices = [...menu.matchAll(/data-theme-choice="(\w+)"/g)].map((m) => m[1]);
    expect(choices).toEqual(["dark", "light", "system"]);
    expect(menu).toMatch(/<form action="\/auth\/signout" method="post">[\s\S]*?Sign out/);
  });

  it("saves the display name to user metadata", async () => {
    const updateUser = vi.fn(async () => ({ error: null }));
    expect(await saveDisplayName("  Sabine Keller ", { updateUser })).toEqual({ ok: true, name: "Sabine Keller" });
    expect(updateUser).toHaveBeenCalledWith({ data: { full_name: "Sabine Keller" } });
    updateUser.mockClear();
    expect(await saveDisplayName(" ", { updateUser })).toMatchObject({ ok: false });
    expect(await saveDisplayName("x".repeat(61), { updateUser })).toMatchObject({ ok: false });
    expect(updateUser).not.toHaveBeenCalled();
    expect(await saveDisplayName("Sabine", { updateUser: async () => ({ error: { message: "nope" } }) })).toEqual({ ok: false, error: "Could not save the name." });
  });

  it("switches the theme: dark, light, and system following the OS setting, remembered", () => {
    const attrs = new Map<string, string>();
    const doc = { documentElement: { getAttribute: (n: string) => attrs.get(n) ?? null, setAttribute: (n: string, v: string) => void attrs.set(n, v) } };
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    applyThemeChoice(doc, storage, "light");
    expect(attrs.get("data-theme")).toBe("light");
    expect(storedChoice(storage)).toBe("light");
    applyThemeChoice(doc, storage, "dark");
    expect(attrs.get("data-theme")).toBe("dark");
    applyThemeChoice(doc, storage, "system", () => ({ matches: true }));
    expect(attrs.get("data-theme")).toBe("light");
    expect(store.get(THEME_KEY)).toBe("system");
    expect(storedChoice(storage)).toBe("system");
    expect(storedChoice(null)).toBe("system");
  });

  it("signed-out and local users get no sign-out and no name edit", () => {
    const local = renderToStaticMarkup(<ShellHeader user={{ mode: "local", workspaceName: "local", email: null, role: "owner" }} />);
    expect(local).toMatch(/data-testid="user-name"[^>]*>Local user<\/span>/);
    expect(local).not.toContain("edit-name");
    expect(local).not.toContain("Sign out");
  });
});

describe("Rename workspace", () => {
  it("validates, then PATCHes /api/workspace with the trimmed name and city", async () => {
    const bad = deps();
    expect((await renameWorkspace({ name: "  ", city: "" }, bad.deps)).ok).toBe(false);
    expect(bad.fetch).not.toHaveBeenCalled();
    const d = deps(200);
    expect(await renameWorkspace({ name: " Treasury ", city: " Zug " }, d.deps)).toEqual({ ok: true });
    expect(d.fetch).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Treasury", city: "Zug" }) }));
    expect(d.reload).not.toHaveBeenCalled();
  });

  it("shows the refusal for a non-owner", async () => {
    expect(await renameWorkspace({ name: "Treasury", city: "" }, deps(403).deps)).toEqual({ ok: false, error: "Only owners can rename the workspace." });
  });
});
