// /onboarding page: signed out goes to login; the workspace step shows the workspace (and 'Create another workspace')
// or the invite case; ?step=agent embeds the new-agent flow; a stored state resumes at the first open step.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextResult, RequestContext } from "@/lib/auth/context";
import { emptyState, markStep } from "@/lib/onboarding/state";

const state = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/lib/auth/context", () => ({ getRequestContext: async () => state.result }));
vi.mock("../agents/new/experts", () => ({ loadExpertOptions: async () => [{ userId: "u1", name: "Sabine", label: "s@example.com", initial: "S" }] }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {} }),
}));

import OnboardingPage from "./page";

const ctx = (over: Partial<RequestContext> = {}): ContextResult => ({
  kind: "ok",
  ctx: {
    mode: "supabase",
    userId: "u1",
    email: "a@example.com",
    workspaceId: "w1",
    workspaceName: "Anna's workspace",
    role: "owner",
    supabase: null,
    memberships: [{ workspaceId: "w1", name: "Anna's workspace", role: "owner", city: "Zug" }],
    ...over,
  },
});
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  state.result = ctx();
});

describe("/onboarding", () => {
  it("signed out goes to login with next=/onboarding", async () => {
    state.result = { kind: "signed_out" };
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /login?next=/onboarding");
  });

  it("workspace step: the auto-created workspace with its city, and Create another workspace", async () => {
    const html = await render();
    expect(html).toContain('data-step="workspace"');
    expect(html).toContain("Anna&#x27;s workspace · Zug");
    expect(html).toContain("Create another workspace");
    expect(html).toContain("Skip for now");
  });

  it("invite case: 'You joined <name> as <role>' instead of the created workspace", async () => {
    state.result = ctx({ role: "expert", workspaceId: "w2", workspaceName: "Finance", memberships: [{ workspaceId: "w2", name: "Finance", role: "expert" }] });
    const html = await render();
    expect(html.replace(/<!-- -->|<\/?strong>/g, "")).toContain("You joined Finance as expert");
    expect(html).not.toContain('data-testid="workspace-name"');
  });

  it("resumes at the first open step from the stored state; ?step=agent embeds the agent flow", async () => {
    const onboarding = markStep(markStep(emptyState(), "workspace", "done", "t"), "permissions", "skipped", "t");
    state.result = ctx({ onboarding });
    let html = await render();
    expect(html).toContain('data-step="agent"');
    expect(html).toContain('id="na-name"');
    expect(html).toContain("Sabine");
    state.result = ctx({ role: "learner" });
    html = await render({ step: "agent" });
    expect(html).toContain("Only owners and experts create agents");
  });

  it("walkthrough step ends with Start your first training and Later", async () => {
    const html = await render({ step: "training" });
    expect(html).toContain('data-testid="walkthrough"');
    expect(html).not.toContain("Skip for now");
  });
});
