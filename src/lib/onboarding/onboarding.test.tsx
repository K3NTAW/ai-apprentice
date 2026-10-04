// Onboarding (T-0211): state model (redirect until completed, skip and resume, grandfathering, kill switch), the
// permission rows from a mocked bridge, the browser variant, the embedded agent flow, the walkthrough chords and
// 'Start your first training' (sets the flag, Capture with the agent).
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }) }));

import NewAgentFlow from "@/components/agents/NewAgentFlow";
import OnboardingFlow, { saveWorkspaceRename } from "@/components/onboarding/OnboardingFlow";
import PermissionsStep, { PermissionsView } from "@/components/onboarding/PermissionsStep";
import Walkthrough from "@/components/onboarding/Walkthrough";
import UserCard from "@/components/shell/UserCard";
import { startFirstTraining, saveStep, ONBOARDING_API } from "./client";
import { canRelaunch, grantPermission, permissionRows, relaunchApp, type DesktopBridge } from "./permissions";
import {
  afterSignIn,
  emptyState,
  finishSetupVisible,
  markStep,
  META_KEYS,
  onboardingEnabled,
  ONBOARDING_STEPS,
  resumeStep,
  stateFromUser,
  toMetadata,
} from "./state";
import { chordGlyphs, DEFAULT_CHORDS, WALKTHROUGH } from "./walkthrough";

const NEW_USER = { created_at: "2026-10-04T08:00:00Z", user_metadata: {} };
const NOW = "2026-10-04T09:00:00Z";

describe("redirect until completed", () => {
  it("sends a new user to /onboarding after sign-in, keeping next", () => {
    expect(afterSignIn(NEW_USER, "/agents", true)).toBe("/onboarding?next=%2Fagents");
    expect(afterSignIn(NEW_USER, "/", true)).toBe("/onboarding");
  });

  it("keeps redirecting while steps are open, and stops once onboarding_completed_at is set", () => {
    let s = emptyState();
    for (const step of ONBOARDING_STEPS.slice(0, 3)) {
      s = markStep(s, step, "done", NOW);
      expect(afterSignIn({ ...NEW_USER, user_metadata: toMetadata(s) }, "/agents", true)).toMatch(/^\/onboarding/);
    }
    s = markStep(s, "training", "done", NOW);
    expect(s.completedAt).toBe(NOW);
    expect(afterSignIn({ ...NEW_USER, user_metadata: toMetadata(s) }, "/agents", true)).toBe("/agents");
  });

  it("grandfathers users from before onboarding and users of unknown age; never loops on /onboarding", () => {
    expect(afterSignIn({ created_at: "2026-10-01T00:00:00Z", user_metadata: {} }, "/agents", true)).toBe("/agents");
    expect(afterSignIn({ user_metadata: {} }, "/agents", true)).toBe("/agents");
    expect(afterSignIn(NEW_USER, "/onboarding", true)).toBe("/onboarding");
  });

  it("kill switch: ONBOARDING_ENABLED=0 turns the redirect off, default on", () => {
    expect(onboardingEnabled(undefined)).toBe(true);
    expect(onboardingEnabled("1")).toBe(true);
    for (const v of ["0", "false", "off"]) expect(onboardingEnabled(v)).toBe(false);
    expect(afterSignIn(NEW_USER, "/agents", false)).toBe("/agents");
  });
});

describe("skip and resume", () => {
  it("skipping every step completes onboarding but keeps 'Finish setup' visible", () => {
    let s = emptyState();
    for (const step of ONBOARDING_STEPS) s = markStep(s, step, "skipped", NOW);
    expect(s.completedAt).toBe(NOW);
    expect(finishSetupVisible(s)).toBe(true);
    expect(resumeStep(s)).toBe("workspace");
  });

  it("resumes at the first unmarked step, a done step never goes back to skipped, the agent id is kept", () => {
    let s = markStep(emptyState(), "workspace", "done", NOW);
    s = markStep(s, "permissions", "skipped", NOW);
    expect(resumeStep(s)).toBe("agent");
    s = markStep(s, "agent", "done", NOW, "agent-1");
    s = markStep(s, "agent", "skipped", NOW);
    expect(s.steps.agent).toBe("done");
    expect(s.agentId).toBe("agent-1");
    expect(resumeStep(s)).toBe("training");
    expect(stateFromUser({ ...NEW_USER, user_metadata: toMetadata(s) })).toEqual(s);
    expect(Object.keys(toMetadata(s)).sort()).toEqual(Object.values(META_KEYS).sort());
  });

  it("all steps done hides 'Finish setup'; the user menu shows it while open", () => {
    let s = emptyState();
    for (const step of ONBOARDING_STEPS) s = markStep(s, step, "done", NOW);
    expect(finishSetupVisible(s)).toBe(false);
    const user = { mode: "supabase" as const, email: "a@example.com", role: "owner", workspaceName: "Finance" };
    expect(renderToStaticMarkup(<UserCard user={{ ...user, onboardingOpen: true }} />)).toContain("Finish setup");
    expect(renderToStaticMarkup(<UserCard user={user} />)).not.toContain("Finish setup");
  });
});

function fakeBridge(status: unknown, actions?: string[]) {
  const calls: string[] = [];
  const bridge: DesktopBridge = {
    on: (type, h) => {
      if (type === "status") h(status);
      return () => {};
    },
    window: (a) => void calls.push(`window:${a}`),
    openPermissionSettings: async (kind) => {
      calls.push(`grant:${kind}`);
      return { ok: true, opened: kind };
    },
    ...(actions ? { windowActions: actions } : {}),
  };
  return { bridge, calls };
}

describe("permissions step", () => {
  const status = { type: "status", version: "1", protocol: 3, permissions: { screen: true, accessibility: false, input: true } };

  it("rows come from the bridge status; microphone is unknown when the app does not report it", () => {
    expect(permissionRows(status).map((r) => [r.kind, r.value])).toEqual([
      ["microphone", "unknown"],
      ["screen", "granted"],
      ["accessibility", "missing"],
      ["input-monitoring", "granted"],
    ]);
    expect(permissionRows({ permissions: { ...status.permissions, microphone: true } })[0].value).toBe("granted");
    expect(permissionRows(null).every((r) => r.value === "unknown")).toBe(true);
  });

  it("Grant opens the settings pane through the bridge; Restart app only when the app accepts relaunch", async () => {
    const { bridge, calls } = fakeBridge(status, ["step-aside", "restore", "focus", "relaunch"]);
    expect(await grantPermission(bridge, "accessibility")).toEqual({ ok: true, opened: "accessibility" });
    expect(relaunchApp(bridge)).toBe(true);
    expect(calls).toEqual(["grant:accessibility", "window:relaunch"]);
    const old = fakeBridge(status);
    expect(canRelaunch(old.bridge)).toBe(false);
    expect(relaunchApp(old.bridge)).toBe(false);
    expect(old.calls).toEqual([]);
    expect(await grantPermission({ on: () => () => {}, window: () => {} }, "screen")).toEqual({ ok: false, reason: "unsupported" });
  });

  it("renders check marks, Grant buttons, the restart note and Restart app inside the app", () => {
    const html = renderToStaticMarkup(<PermissionsView rows={permissionRows(status)} relaunch onGrant={() => {}} onRelaunch={() => {}} />);
    expect(html).toContain('data-permission="screen" data-value="granted"');
    expect(html.match(/>Grant</g)).toHaveLength(2);
    expect(html).toContain("macOS may need the app restarted");
    expect(html).toContain("Restart app");
    expect(renderToStaticMarkup(<PermissionsStep bridge={fakeBridge(status).bridge} />)).toContain('data-testid="permissions-app"');
  });

  it("browser variant: Get the desktop app, no permission rows", () => {
    const html = renderToStaticMarkup(<PermissionsStep bridge={null} />);
    expect(html).toContain('data-testid="permissions-browser"');
    expect(html).not.toContain("data-permission");
  });
});

describe("first agent", () => {
  it("embedded flow has no own stepper, Cancel or step 3; a stored agent id resumes at the avatar", () => {
    const fresh = renderToStaticMarkup(<NewAgentFlow embedded={{ onCreated: () => {} }} />);
    expect(fresh).toContain('id="na-name"');
    expect(fresh).not.toContain('aria-label="Steps"');
    expect(fresh).not.toContain("Cancel");
    const resumed = renderToStaticMarkup(<NewAgentFlow initialAgentId="agent-1" embedded={{ onCreated: () => {} }} />);
    expect(resumed).toContain('data-screen="new-agent-2"');
    expect(resumed).not.toContain('data-step="3"');
    expect(renderToStaticMarkup(<NewAgentFlow initialAgentId="agent-1" />)).toContain('data-step="3"');
  });
});

describe("how training works", () => {
  it("chords match the desktop app's default bindings", () => {
    const src = readFileSync("companion/src/shortcuts.mts", "utf8");
    expect(src).toContain("off_record_toggle: `${m}+Shift+O`");
    expect(src).toContain("end_task: `${m}+Shift+E`");
    expect(DEFAULT_CHORDS).toEqual({ off_record_toggle: "Option+Shift+O", end_task: "Option+Shift+E" });
    expect(chordGlyphs(DEFAULT_CHORDS.off_record_toggle)).toBe("⌥⇧O");
    expect(WALKTHROUGH.map((c) => c.art)).toEqual(["dock", "quiet", "offrecord", "end", "buddy"]);
    expect(WALKTHROUGH.some((c) => c.body.includes("⌥⇧E"))).toBe(true);
  });

  it("the walkthrough starts at card 1 of 5", () => {
    const html = renderToStaticMarkup(<Walkthrough onStart={() => {}} onLater={() => {}} />);
    expect(html).toContain('data-card="1"');
    expect(html.replace(/<!-- -->/g, "")).toContain("1 of 5");
  });

  it("'Start your first training' marks the walkthrough done and goes to Capture with the agent", async () => {
    const bodies: unknown[] = [];
    let done = emptyState();
    for (const s of ONBOARDING_STEPS.slice(0, 3)) done = markStep(done, s, "done", NOW, "agent-1");
    const fetch = async (url: string, init?: RequestInit) => {
      expect(url).toBe(ONBOARDING_API);
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ state: markStep(done, "training", "done", NOW) });
    };
    const r = await startFirstTraining("agent-1", { fetch });
    expect(r.href).toBe("/capture?agent=agent-1");
    expect(bodies).toEqual([{ step: "training", mark: "done", agentId: "agent-1" }]);
    expect(r.save.ok && r.save.state.completedAt).toBe(NOW);
  });

  it("a failed save does not block: the error is returned, the caller moves on", async () => {
    const r = await saveStep("permissions", "skipped", { fetch: async () => new Response("", { status: 500 }) });
    expect(r).toEqual({ ok: false, error: expect.stringContaining("could not be saved") });
    expect((await saveStep("agent", "done", { fetch: async () => Promise.reject(new Error("offline")) })).ok).toBe(false);
  });
});

describe("workspace rename in onboarding", () => {
  const flow = (role: "owner" | "learner", joined: { name: string; role: "owner" | "learner" } | null = null, mode: "local" | "supabase" = "supabase") =>
    renderToStaticMarkup(
      <OnboardingFlow initial={emptyState()} mode={mode} workspace={{ name: "Finance Ops", city: "Zug", role }} joined={joined} canCreateAgents experts={[]} next="/" startStep="workspace" />,
    );

  it("an owner of their own workspace sees Edit, also in local mode; a learner or someone who joined does not", () => {
    expect(flow("owner")).toContain('data-testid="rename-open"');
    expect(flow("owner", null, "local")).toContain('data-testid="rename-open"');
    expect(flow("owner")).toMatch(/data-testid="workspace-name"[^>]*>Finance Ops · Zug</);
    expect(flow("learner")).not.toContain("rename-open");
    expect(flow("owner", { name: "Treasury", role: "learner" })).not.toContain("rename-open");
  });

  it("a successful rename refreshes the route so the shell and sidebar show the new name", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const refresh = vi.fn();
    const r = await saveWorkspaceRename({ name: " Treasury ", city: "" }, null, { fetch: fetch as never, refresh });
    expect(r).toEqual({ ok: true, shown: { name: "Treasury", city: null } });
    expect(refresh).toHaveBeenCalledTimes(1);
    // Empty and unchanged city: left out of the body.
    expect(fetch).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "Treasury" }) }));
  });

  it("clearing a city sends null; a failed rename shows the error and does not refresh", async () => {
    const ok = vi.fn(async () => new Response("{}", { status: 200 }));
    await saveWorkspaceRename({ name: "Treasury", city: " " }, "Zug", { fetch: ok as never, refresh: () => {} });
    expect(ok).toHaveBeenCalledWith("/api/workspace", expect.objectContaining({ body: JSON.stringify({ name: "Treasury", city: null }) }));
    const refresh = vi.fn();
    const denied = vi.fn(async () => new Response("{}", { status: 403 }));
    expect(await saveWorkspaceRename({ name: "Treasury", city: "" }, null, { fetch: denied as never, refresh })).toEqual({ ok: false, error: "Only owners can rename the workspace." });
    expect(refresh).not.toHaveBeenCalled();
  });
});
