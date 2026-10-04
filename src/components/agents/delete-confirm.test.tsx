// @vitest-environment jsdom
// The delete confirm names what goes (GET /api/agents/[id]/deletion), only the owner or the creator sees Delete,
// and a delete refreshes the layout so the sidebar recents drop the agent's sessions.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/agents/settings";
import AgentSettings, { canDeleteAgent, deleteConfirmText } from "./AgentSettings";
import { AGENT_A } from "./fixtures";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => <a href={href} {...rest}>{children}</a> }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const agent = { ...AGENT_A, name: "Pip" };
let host: HTMLDivElement;
let root: Root | null = null;
let calls: { url: string; method: string }[];

function stubFetch(canDelete: boolean) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    if (method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/deletion")) return Response.json({ can_delete: canDelete, processes: 3, sessions: 1 });
    return Response.json({ settings: DEFAULT_SETTINGS, available: true });
  });
}

async function mount(role: "owner" | "expert") {
  await act(async () => {
    root = createRoot(host);
    root.render(<AgentSettings agent={agent} role={role} workMaps={3} />);
  });
  await act(async () => {});
}

const button = (text: string) => [...host.querySelectorAll("button")].find((b) => b.textContent === text);

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  nav.push.mockClear();
  nav.refresh.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

describe("agent delete confirm", () => {
  it("names the counts", () => {
    expect(deleteConfirmText(3, 1)).toBe("This deletes the agent, its 3 processes and 1 training session. This cannot be undone.");
    expect(deleteConfirmText(1, 0)).toBe("This deletes the agent, its 1 process and 0 training sessions. This cannot be undone.");
  });

  it("only the owner or the creator may delete", () => {
    expect(canDeleteAgent("owner")).toBe(true);
    expect(canDeleteAgent("expert")).toBe(false);
    expect(canDeleteAgent("expert", true)).toBe(true);
    expect(canDeleteAgent("learner", false)).toBe(false);
  });

  it("the creator sees Delete; the confirm shows the counts; a delete refreshes the layout", async () => {
    stubFetch(true);
    await mount("expert");
    act(() => button("Delete")!.click());
    expect(host.querySelector('[data-testid="delete-confirm-text"]')?.textContent).toBe(deleteConfirmText(3, 1));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Agent name"]')!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "Pip");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Delete Pip")!.click());
    expect(calls).toContainEqual({ url: `/api/agents/${agent.id}`, method: "DELETE" });
    expect(nav.push).toHaveBeenCalledWith("/agents");
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("an expert who did not create the agent only requests deletion", async () => {
    stubFetch(false);
    await mount("expert");
    expect(button("Delete")).toBeUndefined();
    expect(button("Request deletion")).toBeDefined();
  });
});
