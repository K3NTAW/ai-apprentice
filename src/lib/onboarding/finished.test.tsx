// T-0255: onboarding completion is stored per user on the server (Supabase user_metadata, local mode the data dir
// file) and a finished user is never sent through onboarding again, on any browser or device.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextResult, RequestContext } from "@/lib/auth/context";

const state = vi.hoisted(() => ({ result: null as unknown, local: null as unknown }));
vi.mock("@/lib/auth/context", () => ({ getRequestContext: async () => state.result }));
vi.mock("@/app/agents/new/experts", () => ({ loadExpertOptions: async () => [] }));
vi.mock("@/lib/onboarding/file", () => ({ readLocalOnboarding: async () => state.local }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  useRouter: () => ({ push: () => {} }),
}));

import OnboardingPage from "@/app/onboarding/page";
import UserCard from "@/components/shell/UserCard";
import { signForwardedUser, verifyForwardedUser } from "@/lib/auth/forwardedUser";
import { afterSignIn, emptyState, finishedRedirect, finishSetupHref, markStep, ONBOARDING_STEPS, toMetadata, type OnboardingState } from "./state";

const NOW = "2026-10-04T10:00:00Z";
const allDone = (): OnboardingState => ONBOARDING_STEPS.reduce((s, k) => markStep(s, k, "done", NOW), emptyState());
const withSkip = (): OnboardingState => ONBOARDING_STEPS.reduce((s, k) => markStep(s, k, k === "permissions" ? "skipped" : "done", NOW), emptyState());
const NEW_USER = { created_at: "2026-10-04T09:00:00Z" };

const ctx = (over: Partial<RequestContext> = {}): ContextResult => ({
  kind: "ok",
  ctx: {
    mode: "supabase",
    userId: "u1",
    email: "a@example.com",
    workspaceId: "w1",
    workspaceName: "W",
    role: "owner",
    supabase: null,
    memberships: [{ workspaceId: "w1", name: "W", role: "owner", city: null }],
    ...over,
  },
});
const render = async (sp: Record<string, string> = {}) => renderToStaticMarkup(await OnboardingPage({ searchParams: Promise.resolve(sp) }));

beforeEach(() => {
  state.result = ctx();
  state.local = emptyState();
  vi.stubEnv("FORWARDED_USER_SECRET", "test-secret");
});

describe("finishedRedirect", () => {
  it("shows the flow while not complete, sends a finished user to next (never back to /onboarding)", () => {
    expect(finishedRedirect(emptyState(), "/agents", false)).toBeNull();
    expect(finishedRedirect(allDone(), "/agents", false)).toBe("/agents");
    expect(finishedRedirect(allDone(), "/learn", true)).toBe("/learn");
    expect(finishedRedirect(allDone(), "/onboarding", false)).toBe("/agents");
  });

  it("an explicit resume with a skipped step shows the flow again; without it the user is not redirected there", () => {
    expect(finishedRedirect(withSkip(), "/agents", true)).toBeNull();
    expect(finishedRedirect(withSkip(), "/agents", false)).toBe("/agents");
    expect(finishSetupHref).toBe("/onboarding?resume=1");
  });
});

describe("afterSignIn reads the stored flag", () => {
  it("a finished user never lands on onboarding, even with next=/onboarding", () => {
    const user = { ...NEW_USER, user_metadata: toMetadata(allDone()) };
    expect(afterSignIn(user, "/agents", true)).toBe("/agents");
    expect(afterSignIn(user, "/onboarding", true)).toBe("/agents");
    expect(afterSignIn(user, "/onboarding?next=%2Flearn", true)).toBe("/agents");
  });

  it("an unfinished user still goes to onboarding", () => {
    expect(afterSignIn(NEW_USER, "/agents", true)).toBe("/onboarding?next=%2Fagents");
    expect(afterSignIn(NEW_USER, "/onboarding", true)).toBe("/onboarding");
  });
});

describe("forwarded user carries the stored onboarding state", () => {
  it("a finished user arrives as finished, an unfinished one with its steps", () => {
    const done = verifyForwardedUser(signForwardedUser({ id: "u1", ...NEW_USER, user_metadata: toMetadata(allDone()) }));
    expect(done?.onboarding?.completedAt).toBe(NOW);
    const open = markStep(emptyState(), "workspace", "done", NOW);
    const fwd = verifyForwardedUser(signForwardedUser({ id: "u1", ...NEW_USER, user_metadata: toMetadata(open) }));
    expect(fwd?.onboarding).toEqual(open);
  });
});

describe("/onboarding for a finished user", () => {
  it("supabase: a completed state redirects to next, /agents by default, on any browser (state is server side)", async () => {
    state.result = ctx({ onboarding: allDone() });
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /agents");
    await expect(render({ next: "/learn" })).rejects.toThrow("NEXT_REDIRECT /learn");
    await expect(render({ next: "/onboarding" })).rejects.toThrow("NEXT_REDIRECT /agents");
  });

  it("local mode reads the file store the same way", async () => {
    state.result = ctx({ mode: "local", onboarding: undefined });
    state.local = allDone();
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /agents");
    state.local = emptyState();
    expect(await render()).toContain('data-screen="onboarding"');
  });

  it("'Finish setup' (?resume=1) still opens the flow for a skipped step", async () => {
    state.result = ctx({ onboarding: withSkip() });
    expect(await render({ resume: "1" })).toContain('data-step="permissions"');
    await expect(render()).rejects.toThrow("NEXT_REDIRECT /agents");
  });

  it("the user menu's Finish setup links with the resume flag", () => {
    const html = renderToStaticMarkup(
      <UserCard user={{ mode: "supabase", workspaceName: "W", email: "a@example.com", role: "owner", onboardingOpen: true }} />,
    );
    expect(html).toContain('href="/onboarding?resume=1"');
  });
});
