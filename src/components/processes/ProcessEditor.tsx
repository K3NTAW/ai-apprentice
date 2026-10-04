"use client";

// Process page (processes slice d): rename; edit a step's title, decision and reason (an edited quote shows 'edited by
// <name>', the original stays in the version history); reorder and delete steps; add, edit and delete guardrails;
// archive and delete (owner, confirm first); version history with restore; 'Add to this process' and 'Retrain from
// scratch' open Capture with ?process&mode. Every Work Map change is a PATCH with expected_version (409: reload).
// Learners see the page read-only.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Card, ScoreBar, buttonClass, type BadgeKind } from "@/components/ui";
import { agentHref } from "@/components/agents/model";
import { understandingPercent } from "@/lib/agents/status";
import type { Role } from "@/lib/auth/context";
import { confirmThen } from "@/lib/confirm";
import * as api from "@/lib/processes/client";
import {
  ARCHIVE_PROCESS_CONFIRM,
  DELETE_PROCESS_CONFIRM,
  DELETE_STEP_CONFIRM,
  RESTORE_VERSION_CONFIRM,
  addGuardrail,
  canArchiveProcess,
  canDeleteProcess,
  canEditProcess,
  deleteGuardrail,
  deleteStep,
  editGuardrail,
  editStep,
  moveStep,
} from "@/lib/processes/edit";
import { trainHref } from "@/lib/processes/train";
import type { Process, ProcessVersion } from "@/lib/store/types";
import type { Guardrail, WorkMap, WorkMapStep } from "@/lib/types";
import { guardrailKindLabel } from "@/lib/workmap/view";

export type ProcessEditorProps = {
  id: string;
  role: Role | null;
  /** The signed-in person's name, for 'edited by'. */
  editor: string;
  /** Preview and tests: the data, nothing is fetched. */
  initial?: { process: Process; versions: ProcessVersion[] };
};

const KINDS: Guardrail["kind"][] = ["limit", "exception", "stop_and_ask"];
const GUARD_KIND: Record<Guardrail["kind"], BadgeKind> = { limit: "limit", exception: "exception", stop_and_ask: "stop_and_ask" };
const CHANGE_LABEL: Record<ProcessVersion["change_kind"], string> = { trained: "Trained", extended: "Added to", replaced: "Retrained", edited: "Edited" };
const muted = { color: "var(--mu)" } as const;
const field = "ui-inp w-full";

function EditedBy({ name }: { name?: string }) {
  return name ? (
    <span className="text-xs" style={{ color: "var(--fa)" }} data-testid="edited-by">
      edited by {name}
    </span>
  ) : null;
}

function GuardrailRow({ g, editable, onSave, onDelete }: { g: Guardrail; editable: boolean; onSave: (p: Partial<Guardrail>) => void; onDelete: () => void }) {
  const [rule, setRule] = useState(g.rule);
  const [kind, setKind] = useState(g.kind);
  const [quote, setQuote] = useState(g.quote ?? "");
  if (!editable)
    return (
      <li className="flex flex-col" style={{ gap: 4 }}>
        <span className="flex items-center" style={{ gap: 8 }}>
          <Badge kind={GUARD_KIND[g.kind]}>{guardrailKindLabel(g.kind)}</Badge>
          {g.rule}
        </span>
        {g.quote && <q style={muted}>{g.quote}</q>}
        <EditedBy name={g.edited_by} />
      </li>
    );
  return (
    <li className="grid items-start" style={{ gridTemplateColumns: "150px minmax(0, 1fr) auto", gap: 10 }}>
      <select className="ui-inp" aria-label="Guardrail kind" value={kind} onChange={(e) => setKind(e.target.value as Guardrail["kind"])}>
        {KINDS.map((k) => (
          <option key={k} value={k}>
            {guardrailKindLabel(k)}
          </option>
        ))}
      </select>
      <div className="flex flex-col" style={{ gap: 6 }}>
        <input className={field} aria-label="Guardrail rule" value={rule} onChange={(e) => setRule(e.target.value)} />
        <input className={field} aria-label="Guardrail quote" placeholder="Quote (optional)" value={quote} onChange={(e) => setQuote(e.target.value)} />
        <EditedBy name={g.edited_by} />
      </div>
      <div className="flex" style={{ gap: 6 }}>
        <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onSave({ rule, kind, quote })}>
          Save
        </button>
        <button type="button" className={buttonClass("ghost", "sm")} onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

function StepCard(props: {
  step: WorkMapStep;
  first: boolean;
  last: boolean;
  editable: boolean;
  busy: boolean;
  change: (fn: (wm: WorkMap) => WorkMap, confirm?: string) => void;
  editor: string;
}) {
  const { step: s, editable, busy, change, editor } = props;
  const [title, setTitle] = useState(s.title);
  const [decision, setDecision] = useState(s.decision);
  const [reason, setReason] = useState(s.reason?.quote ?? "");
  const [rule, setRule] = useState("");
  const [kind, setKind] = useState<Guardrail["kind"]>("limit");
  return (
    <Card style={{ padding: "18px 20px" }}>
      <div className="flex flex-col" style={{ gap: 12 }} data-testid={`step-${s.n}`}>
        <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
          <span className="ui-mono text-xs" style={muted}>
            Step {s.n}
            {s.is_judgment_call && " · judgment call"}
          </span>
          {editable && (
            <div className="flex" style={{ gap: 6 }}>
              <button type="button" disabled={busy || props.first} title={props.first ? "Already the first step" : undefined} className={buttonClass("ghost", "sm")} onClick={() => change((wm) => moveStep(wm, s.n, -1))}>
                Move up
              </button>
              <button type="button" disabled={busy || props.last} title={props.last ? "Already the last step" : undefined} className={buttonClass("ghost", "sm")} onClick={() => change((wm) => moveStep(wm, s.n, 1))}>
                Move down
              </button>
              <button type="button" disabled={busy} className={buttonClass("ghost", "sm")} onClick={() => change((wm) => deleteStep(wm, s.n), DELETE_STEP_CONFIRM)}>
                Delete step
              </button>
            </div>
          )}
        </div>
        {editable ? (
          <>
            <input className={field} aria-label={`Step ${s.n} title`} value={title} onChange={(e) => setTitle(e.target.value)} />
            <textarea className={field} aria-label={`Step ${s.n} decision`} rows={2} value={decision} onChange={(e) => setDecision(e.target.value)} />
            <textarea className={field} aria-label={`Step ${s.n} reason`} rows={2} placeholder="Why (the expert's words)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <EditedBy name={s.reason?.edited_by} />
            <button type="button" disabled={busy} className={`${buttonClass("secondary", "sm")} self-start`} onClick={() => change((wm) => editStep(wm, s.n, { title, decision, reason }, editor))}>
              Save step
            </button>
          </>
        ) : (
          <>
            <span className="ui-t3">{s.title}</span>
            <span>{s.decision}</span>
            {s.reason && <q style={muted}>{s.reason.quote}</q>}
            <EditedBy name={s.reason?.edited_by} />
          </>
        )}
        <span className="text-[13px]" style={muted}>
          Guardrails
        </span>
        <ul className="flex flex-col" style={{ gap: 8 }}>
          {s.guardrails.map((g, i) => (
            <GuardrailRow
              key={`${i}|${g.rule}|${g.kind}|${g.quote ?? ""}`}
              g={g}
              editable={editable && !busy}
              onSave={(p) => change((wm) => editGuardrail(wm, s.n, i, p, editor))}
              onDelete={() => change((wm) => deleteGuardrail(wm, s.n, i))}
            />
          ))}
        </ul>
        {editable && (
          <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
            <select className="ui-inp" aria-label="New guardrail kind" value={kind} onChange={(e) => setKind(e.target.value as Guardrail["kind"])}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {guardrailKindLabel(k)}
                </option>
              ))}
            </select>
            <input className="ui-inp" style={{ flex: "1 1 240px" }} aria-label="New guardrail rule" placeholder="New guardrail" value={rule} onChange={(e) => setRule(e.target.value)} />
            <button
              type="button"
              disabled={busy || !rule.trim()}
              title={!rule.trim() ? "Write the rule first" : undefined}
              className={buttonClass("secondary", "sm")}
              onClick={() => {
                change((wm) => addGuardrail(wm, s.n, { rule, kind }, editor));
                setRule("");
              }}
            >
              Add guardrail
            </button>
          </div>
        )}
      </div>
    </Card>
  );
}

export default function ProcessEditor({ id, role, editor, initial }: ProcessEditorProps) {
  const router = useRouter();
  const [process, setProcess] = useState<Process | null>(initial?.process ?? null);
  const [versions, setVersions] = useState<ProcessVersion[]>(initial?.versions ?? []);
  const [title, setTitle] = useState(initial?.process.title ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) return;
    let live = true;
    Promise.all([api.getProcess(id), api.listVersions(id)]).then(
      ([p, v]) => {
        if (!live) return;
        setProcess(p);
        setTitle(p.title);
        setVersions(v);
      },
      (err: unknown) => live && setLoadError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [id, initial]);

  if (loadError) return <p role="alert" style={{ color: "var(--rd)" }}>{loadError}</p>;
  if (!process) return <p style={muted}>Loading the process…</p>;

  const editable = canEditProcess(role);
  const archived = process.archived_at !== null;

  async function run(action: () => Promise<Process | null>, message?: string) {
    setBusy(true);
    setError(null);
    try {
      const go = async () => {
        const next = await action();
        if (next) {
          setProcess(next);
          setTitle(next.title);
          if (!initial) setVersions(await api.listVersions(next.id));
        }
        return true;
      };
      if (message) await confirmThen(message, go);
      else await go();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const p = process;
  const change = (fn: (wm: WorkMap) => WorkMap, message?: string) => void run(() => api.saveWorkMap(p, fn(p.workmap)), message);
  const remove = () =>
    void run(async () => {
      await api.deleteProcess(p.id);
      router.push(agentHref(p.agent_id));
      return null;
    }, DELETE_PROCESS_CONFIRM);

  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 20 }}>
      <Link className="text-[13px] no-underline" style={muted} href={agentHref(p.agent_id)}>
        Agent / Processes / {p.title}
      </Link>
      <Card style={{ padding: "22px 24px" }}>
        <div className="flex flex-col" style={{ gap: 14 }}>
          <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
            {editable ? (
              <>
                <input className="ui-inp" style={{ flex: "1 1 320px", fontSize: 20 }} aria-label="Process title" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
                <button
                  type="button"
                  disabled={busy || !title.trim() || title.trim() === p.title}
                  title={!title.trim() ? "The title cannot be empty" : title.trim() === p.title ? "Change the title first" : undefined}
                  className={buttonClass("secondary", "sm")}
                  onClick={() => void run(() => api.patchProcess(p.id, { title: title.trim() }))}
                >
                  Rename
                </button>
              </>
            ) : (
              <h1 className="ui-td">{p.title}</h1>
            )}
            <Badge kind={p.confirmed ? "confirmed" : "pending"} />
            {archived && <Badge kind="missing">Archived</Badge>}
            <span className="ui-mono text-xs" style={muted}>
              version {p.version}
            </span>
          </div>
          <div style={{ maxWidth: 360 }}>
            <ScoreBar label="Understood" value={understandingPercent(p.workmap)} />
          </div>
          <div className="flex flex-wrap" style={{ gap: 10 }}>
            {editable && (
              <>
                <Link className={buttonClass("primary", "sm")} href={trainHref(p.agent_id, p.id, "extend")}>
                  Add to this process
                </Link>
                <Link className={buttonClass("secondary", "sm")} href={trainHref(p.agent_id, p.id, "replace")}>
                  Retrain from scratch
                </Link>
              </>
            )}
            {canArchiveProcess(role) && (
              <button
                type="button"
                disabled={busy}
                className={buttonClass("ghost", "sm")}
                onClick={() => void run(() => api.patchProcess(p.id, { archived: !archived }), archived ? undefined : ARCHIVE_PROCESS_CONFIRM)}
              >
                {archived ? "Restore" : "Archive"}
              </button>
            )}
            {canDeleteProcess(role) && (
              <button type="button" disabled={busy} className={buttonClass("danger", "sm")} onClick={remove}>
                Delete process
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>
              {error}
            </p>
          )}
        </div>
      </Card>
      <section className="flex flex-col" style={{ gap: 12 }}>
        <h2 className="ui-t3">Steps</h2>
        {p.workmap.steps.length === 0 && <p style={muted}>No steps.</p>}
        {p.workmap.steps.map((s, i) => (
          <StepCard
            // version in the key: drafts reset after every saved change
            key={`${p.version}|${s.n}`}
            step={s}
            first={i === 0}
            last={i === p.workmap.steps.length - 1}
            editable={editable}
            busy={busy}
            change={change}
            editor={editor}
          />
        ))}
      </section>
      <section className="flex flex-col" style={{ gap: 12 }} data-testid="version-history">
        <h2 className="ui-t3">Version history</h2>
        <Card style={{ padding: "0 20px" }}>
          {versions.map((v) => (
            <div key={v.id} className="flex flex-wrap items-center justify-between" style={{ gap: 12, padding: "14px 0", borderBottom: "1px solid var(--ln)" }}>
              <span className="flex flex-col" style={{ gap: 2 }}>
                <span>
                  Version {v.version} · {CHANGE_LABEL[v.change_kind]}
                </span>
                <span className="ui-mono text-xs" style={muted}>
                  {v.created_at.slice(0, 16).replace("T", " ")}
                  {v.source_session_id && ` · session ${v.source_session_id.slice(0, 8)}`}
                </span>
              </span>
              {v.version === p.version ? (
                <Badge kind="accent">Current</Badge>
              ) : (
                editable && (
                  <button type="button" disabled={busy} className={buttonClass("ghost", "sm")} onClick={() => void run(() => api.restoreVersion(p, v), RESTORE_VERSION_CONFIRM)}>
                    Restore
                  </button>
                )
              )}
            </div>
          ))}
        </Card>
      </section>
    </main>
  );
}
