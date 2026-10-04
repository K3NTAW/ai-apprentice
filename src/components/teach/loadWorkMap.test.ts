import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_WORKMAP } from "@/lib/teach/sampleWorkMap";
import type { Session, WorkMap } from "@/lib/types";
import { loadPickerOptions, loadWorkMap, pickerOptions, preselect, SAMPLE_ID, SAMPLE_LABEL } from "./loadWorkMap";

const workmap = (confirmed: boolean, task = "AP"): WorkMap => ({ task, expert: "Sabine", confirmed_by_expert: confirmed, steps: [], open_questions: [] });

const session = (id: string, started_at: string, wm?: WorkMap, kind: Session["kind"] = "capture"): Session => ({
  id,
  kind,
  started_at,
  events: [],
  transcript: [],
  qa: [],
  off_record_ranges: [],
  ...(wm ? { workmap: wm } : {}),
});

const SESSIONS = [
  session("old", "2026-09-01T08:00:00Z", workmap(true)),
  session("draft", "2026-10-02T08:00:00Z", workmap(false)),
  session("bare", "2026-10-02T09:00:00Z"),
  session("teach", "2026-10-02T10:00:00Z", workmap(true), "teach"),
  session("new", "2026-10-01T08:00:00Z", workmap(true)),
];

/** Fake GET /api/workmaps over the given sessions (same filters as the route); status overrides the answer. */
function mockApi(sessions: Session[], status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url, "http://localhost");
      if (u.pathname !== "/api/workmaps") return new Response("{}", { status: 404 });
      if (status !== 200) return Response.json({ error: "x" }, { status });
      const item = (s: Session) => ({ ...s, expert: s.expert ?? null, agent_id: null, ended_at: null });
      const maps = sessions
        .filter((s) => s.kind === "capture" && s.workmap && (u.searchParams.get("confirmed") !== "1" || s.workmap.confirmed_by_expert))
        .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
        .slice(0, Number(u.searchParams.get("limit") ?? 50))
        .map(item);
      const hit = sessions.find((s) => s.id === u.searchParams.get("session_id") && s.workmap);
      return Response.json({ maps, session: hit ? item(hit) : null });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Teach Work Map picker", () => {
  it("lists only confirmed capture maps of the workspace, newest first", () => {
    const opts = pickerOptions(SESSIONS, false);
    expect(opts.map((o) => o.id)).toEqual(["new", "old"]);
    expect(opts[0].label).toBe("Sabine · 2026-10-01 10:00 · AP");
  });

  it("offers the sample only in local mode or when there is no confirmed map, labelled 'Sample (demo)'", () => {
    expect(pickerOptions(SESSIONS, false).some((o) => o.id === SAMPLE_ID)).toBe(false);
    expect(pickerOptions(SESSIONS, true).at(-1)).toEqual({ id: SAMPLE_ID, label: SAMPLE_LABEL });
    expect(pickerOptions([session("draft", "2026-10-02T08:00:00Z", workmap(false))], false)).toEqual([{ id: SAMPLE_ID, label: "Sample (demo)" }]);
  });

  it("preselects ?session=<id> when offered, else the first option", () => {
    const opts = pickerOptions(SESSIONS, true);
    expect(preselect(opts, "old")).toBe("old");
    expect(preselect(opts, "draft")).toBe("new");
    expect(preselect(opts, null)).toBe("new");
    expect(preselect([], null)).toBeNull();
  });

  it("loadPickerOptions reads the workspace sessions through the API", async () => {
    mockApi(SESSIONS);
    expect((await loadPickerOptions(false)).map((o) => o.id)).toEqual(["new", "old"]);
    mockApi([]);
    expect((await loadPickerOptions(false)).map((o) => o.label)).toEqual(["Sample (demo)"]);
  });
});

describe("loadWorkMap", () => {
  it("loads the selected session's map, also an unconfirmed one", async () => {
    mockApi(SESSIONS);
    const l = await loadWorkMap("draft");
    expect(l.sessionId).toBe("draft");
    expect(l.workmap.confirmed_by_expert).toBe(false);
  });

  it("the sample id loads the bundled sample without calling the API", async () => {
    mockApi(SESSIONS);
    const l = await loadWorkMap(SAMPLE_ID);
    expect(l.workmap).toBe(SAMPLE_WORKMAP);
    expect(l.sessionId).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes exactly one request, also for ?session=<id>", async () => {
    mockApi(SESSIONS);
    await loadWorkMap("draft");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("/api/workmaps?confirmed=1&limit=1&session_id=draft");
    vi.mocked(fetch).mockClear();
    const l = await loadWorkMap("bare");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(l.sessionId).toBe("new");
    expect(l.banner).toBe("Session bare has no Work Map. Latest confirmed session new.");
  });

  it.each([401, 403, 500])("a %i answer throws instead of falling back to the sample", async (status) => {
    mockApi(SESSIONS, status);
    await expect(loadWorkMap(null)).rejects.toMatchObject({ name: "WorkMapLoadError", status });
    await expect(loadPickerOptions(false)).rejects.toMatchObject({ status });
  });

  it("falls back to the sample when nothing is confirmed", async () => {
    mockApi([]);
    const l = await loadWorkMap(null);
    expect(l.workmap).toBe(SAMPLE_WORKMAP);
  });
});
