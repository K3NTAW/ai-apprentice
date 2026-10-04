// Deterministic e2e seed: writes agents, sessions with confirmed Work Maps, processes and learners into a temp DATA_DIR.
// Invoice Ivy meets the 'ready to teach' rule (a confirmed process at >= 0.75 understanding, lib/agents/status);
// Ledger Leo has one unconfirmed process, so it is 'training'.
// Never touches ./data. Fails fast when Supabase env is set, because the app must run in local mode.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const E2E_DATA_DIR = path.join(os.tmpdir(), "ai-apprentice-e2e");

export const AGENT_A = "0e2e0000-0000-4000-8000-00000000000a";
export const AGENT_B = "0e2e0000-0000-4000-8000-00000000000b";
export const MAP_SESSION = "e2e-map-confirmed";
export const DEBRIEF_SESSION = "e2e-debrief-open";
export const TEACH_SESSION = "e2e-teach-learner";
export const PROCESS_A = "0e2e0000-0000-4000-8000-0000000000a1";
export const PROCESS_B = "0e2e0000-0000-4000-8000-0000000000b1";

const T0 = "2026-10-01T08:00:00.000Z";

function assertLocal() {
  for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    if ((process.env[k] ?? "").trim() !== "") throw new Error(`e2e seed: ${k} is set; e2e runs in local mode only`);
  }
}

function assertSafeDir(dir) {
  const rel = path.relative(process.cwd(), dir);
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) throw new Error(`e2e seed: DATA_DIR ${dir} is inside the repo`);
}

const avatar = (color) => ({ shape: "blob", face: "smile", color, accent: "#FFD166" });

function step(n, title, judgment) {
  return {
    n,
    title,
    screen_moment: { t: n * 40, app: "Invoices", entity: `invoice INV-10${n}`, field: "approval_status" },
    decision: `Decision for ${title.toLowerCase()}`,
    is_judgment_call: judgment,
    reason: judgment ? { quote: `Because the amount is over the limit at step ${n}`, t: n * 40 + 5, source: "debrief" } : null,
    guardrails: judgment ? [{ rule: "Stop and ask above EUR 10000", quote_ref: n * 40 + 6, kind: "stop_and_ask", quote: "Above ten thousand I always ask" }] : [],
    // Mean understanding (0.6 + 0.9 + 0.9) / 3 = 0.8, above the 0.75 threshold.
    scores: { reason_captured: judgment ? 0.9 : 0.6, guardrail_captured: judgment ? 0.9 : 0.6 },
  };
}

function workmap(confirmed) {
  return {
    task: "Approve supplier invoices",
    expert: "Ana Expert",
    confirmed_by_expert: confirmed,
    steps: [step(1, "Open the invoice", false), step(2, "Check the amount", true), step(3, "Send for approval", true)],
    open_questions: confirmed ? [] : ["What happens with foreign suppliers?"],
    shortcuts: [{ chord: "Cmd+Enter", app: "Invoices", effect: "Send for approval", effect_type: "item_sent", first_t: 120, count: 3, step: 3, why: { quote: "Faster than the button", t: 121 } }],
  };
}

function session(id, kind, extra) {
  return { id, kind, started_at: T0, events: [], transcript: [], qa: [], off_record_ranges: [], frames: [], ...extra };
}

function processRow(id, vid, agent_id, wm, source_session_id) {
  const p = { id, workspace_id: "local", agent_id, title: wm.task, workmap: wm, version: 1, confirmed: wm.confirmed_by_expert, archived_at: null, created_by: null, created_at: T0, updated_at: T0 };
  const v = { id: vid, process_id: id, version: 1, workmap: wm, source_session_id, change_kind: "trained", changed_by: null, created_at: T0 };
  return { p, v };
}

/** data/processes.json: Ivy's confirmed map as a process (linked to MAP_SESSION), Leo's unconfirmed one without a session. */
function processes() {
  const rows = [processRow(PROCESS_A, `${PROCESS_A.slice(0, -2)}c1`, AGENT_A, workmap(true), MAP_SESSION), processRow(PROCESS_B, `${PROCESS_B.slice(0, -2)}c2`, AGENT_B, { ...workmap(false), task: "Close the month" }, null)];
  return { processes: rows.map((r) => r.p), versions: rows.map((r) => r.v), tombstones: [] };
}

export function seed(dir = E2E_DATA_DIR) {
  assertLocal();
  assertSafeDir(dir);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, "sessions"), { recursive: true });
  const agents = [
    { id: AGENT_A, workspace_id: "local", name: "Invoice Ivy", role: "Accounts payable", expert_name: "Ana Expert", avatar: avatar("#7C5CFF"), created_at: T0, updated_at: T0 },
    { id: AGENT_B, workspace_id: "local", name: "Ledger Leo", role: "Month-end close", avatar: avatar("#2EC4B6"), created_at: T0, updated_at: T0 },
  ];
  writeFileSync(path.join(dir, "agents.json"), JSON.stringify(agents, null, 2));
  const sessions = [
    session(MAP_SESSION, "capture", {
      ended_at: "2026-10-01T08:20:00.000Z",
      expert: "Ana Expert",
      agent_id: AGENT_A,
      process_id: PROCESS_A,
      workmap: workmap(true),
      transcript: [{ id: "tr1", t: 85, speaker: "expert", text: "Above ten thousand I always ask", phase: "capture", redacted: false }],
    }),
    session(DEBRIEF_SESSION, "capture", { ended_at: "2026-10-02T08:20:00.000Z", expert: "Ana Expert", agent_id: AGENT_A, workmap: workmap(false) }),
    session(TEACH_SESSION, "teach", {
      started_at: "2026-10-03T08:00:00.000Z",
      // Ended, so the sidebar never shows it as a live session with a clock-dependent elapsed time.
      ended_at: "2026-10-03T08:30:00.000Z",
      expert: "Lena Learner",
      agent_id: AGENT_A,
      teach: { workmap_session_id: MAP_SESSION, mastered: ["1"], practice: ["2"], interventions: 1 },
    }),
  ];
  for (const s of sessions) {
    mkdirSync(path.join(dir, "sessions", s.id, "frames"), { recursive: true });
    writeFileSync(path.join(dir, "sessions", s.id, "session.json"), JSON.stringify(s, null, 2));
  }
  writeFileSync(path.join(dir, "processes.json"), JSON.stringify(processes(), null, 2));
  return dir;
}

export function teardown(dir = E2E_DATA_DIR) {
  assertSafeDir(dir);
  rmSync(dir, { recursive: true, force: true });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`e2e seed: ${seed()}`);
}
