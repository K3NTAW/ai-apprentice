// Empty capture runs (T-0213) at the routes, local mode over a temp DATA_DIR: /api/workmap never builds a Work Map
// for one (409 empty_session, so no process can follow) and DELETE /api/session/<id> removes only empty runs.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/types";

const h = vi.hoisted(() => ({ synth: vi.fn() }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => "local" }));
vi.mock("@/lib/auth/context", () => ({
  requireContext: async () => ({ mode: "local", userId: "local", email: null, workspaceId: "local", workspaceName: "local", role: "owner" }),
}));
vi.mock("@/lib/usage", () => ({ consumeUsage: async () => null }));
vi.mock("@/lib/cache/readMostly", () => ({ revalidateScopes: () => undefined }));
vi.mock("@/lib/workmap", async (orig) => ({ ...(await orig<typeof import("@/lib/workmap")>()), synthesizeWorkMap: h.synth }));

import { POST as buildWorkMap } from "../workmap/route";
import { DELETE } from "./[id]/route";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "empty-routes-"));
  vi.stubEnv("DATA_DIR", dir);
  h.synth.mockReset();
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(dir, { recursive: true, force: true });
});

const put = async (s: Partial<Session> & { id: string }) => {
  const full: Session = { kind: "capture", started_at: "2026-10-04T08:00:00.000Z", ended_at: "2026-10-04T08:00:10.000Z", events: [], transcript: [], qa: [], off_record_ranges: [], ...s };
  await mkdir(path.join(dir, "sessions", s.id), { recursive: true });
  await writeFile(path.join(dir, "sessions", s.id, "session.json"), JSON.stringify(full));
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const del = (id: string) => DELETE(new Request(`http://localhost/api/session/${id}`, { method: "DELETE" }), ctx(id));

describe("empty runs at the routes", () => {
  it("/api/workmap answers 409 empty_session and builds nothing", async () => {
    await put({ id: "empty1" });
    const res = await buildWorkMap(new Request("http://localhost/api/workmap", { method: "POST", body: JSON.stringify({ session_id: "empty1" }) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "empty_session" });
    expect(h.synth).not.toHaveBeenCalled();
    const { fileStore } = await import("@/lib/store");
    expect((await fileStore.getSession("empty1"))?.workmap).toBeUndefined();
  });

  it("DELETE removes an empty run (204) and refuses one with work (409)", async () => {
    await put({ id: "empty2" });
    await put({ id: "busy", ended_at: "2026-10-04T08:05:00.000Z", events: [1, 2, 3].map((i) => ({ id: `e${i}`, t: i, source: "vision", type: "record_opened", entity: { kind: "email", id: `m${i}` } })) as Session["events"] });
    expect((await del("empty2")).status).toBe(204);
    const res = await del("busy");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "not_empty" });
    const { fileStore } = await import("@/lib/store");
    expect(await fileStore.getSession("empty2")).toBeNull();
    expect(await fileStore.getSession("busy")).not.toBeNull();
    expect((await del("missing")).status).toBe(404);
  });
});
