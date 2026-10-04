// POST /api/auth/onboarding: local mode writes the file flag; Supabase mode writes user_metadata with updateUser.
// Marking every step sets onboarding_completed_at; a write error answers 500 save_failed.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/lib/auth/context";
import { emptyState } from "@/lib/onboarding/state";

const state = vi.hoisted(() => ({ ctx: null as unknown, updates: [] as unknown[], updateError: null as unknown }));
vi.mock("@/lib/auth/context", () => ({ requireContext: async () => state.ctx }));

import { GET, POST } from "./route";

const post = (body: unknown) => POST(new Request("http://app.test/api/auth/onboarding", { method: "POST", body: JSON.stringify(body) }));
const local = { mode: "local", supabase: null } as unknown as RequestContext;
let prevDir: string | undefined;

beforeEach(() => {
  prevDir = process.env.DATA_DIR;
  process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "onboarding-"));
  state.updates = [];
  state.updateError = null;
});
afterEach(() => {
  if (prevDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDir;
});

describe("onboarding route", () => {
  it("local mode: marks steps in the file flag and completes after the last one", async () => {
    state.ctx = local;
    for (const step of ["workspace", "permissions", "agent"]) expect((await post({ step, mark: "skipped" })).status).toBe(200);
    const last = (await (await post({ step: "training", mark: "done", agentId: "a1" })).json()) as { state: { completedAt: string | null } };
    expect(last.state.completedAt).not.toBeNull();
    const file = JSON.parse(readFileSync(path.join(process.env.DATA_DIR!, "onboarding.json"), "utf8"));
    expect(file).toMatchObject({ steps: { workspace: "skipped", training: "done" }, agentId: "a1" });
    expect(((await (await GET()).json()) as { state: unknown }).state).toEqual(file);
  });

  it("supabase: writes user_metadata with updateUser; completing sets onboarding_completed_at", async () => {
    const steps = { workspace: "done", permissions: "skipped", agent: "done" } as const;
    state.ctx = {
      mode: "supabase",
      onboarding: { ...emptyState(), steps, agentId: "a1" },
      supabase: {
        auth: {
          updateUser: async (attrs: unknown) => {
            state.updates.push(attrs);
            return { error: state.updateError };
          },
        },
      },
    };
    expect((await post({ step: "training", mark: "done" })).status).toBe(200);
    const data = (state.updates[0] as { data: Record<string, unknown> }).data;
    expect(data.onboarding_completed_at).toEqual(expect.any(String));
    expect(data.onboarding_steps).toEqual({ ...steps, training: "done" });
    expect(data.onboarding_agent_id).toBe("a1");

    state.updateError = { message: "boom" };
    const failed = await post({ step: "workspace", mark: "done" });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ error: "save_failed" });
  });

  it("rejects bad input and passes auth errors through", async () => {
    state.ctx = local;
    expect((await post({ step: "nope", mark: "done" })).status).toBe(400);
    expect((await post({ step: "agent", mark: "maybe" })).status).toBe(400);
    state.ctx = Response.json({ error: "unauthorized" }, { status: 401 });
    expect((await post({ step: "agent", mark: "done" })).status).toBe(401);
  });
});
