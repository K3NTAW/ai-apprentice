"use client";

// End of the debrief (processes slice c): save the confirmed Work Map as a process. When the agent has processes
// already, the match decision suggests one: 'Add to it' (merge, shows what changed for confirmation), 'Replace it'
// (the old version stays in the history) or 'Save as a new process', defaulting to the suggestion.
// 503 (migration missing): nothing is shown, the session stays a legacy Work Map.
import { useEffect, useState } from "react";
import { buttonClass } from "@/components/ui";

type Brief = { id: string; title: string; version: number };
type Suggestion = { linked: Brief | null; match: { choice: string; confidence: number; title: string | null }; candidates: Brief[] };
type Choice = "add" | "replace" | "new";
type Saved = { process: { id: string; title: string; version: number } | null; changes: string[]; conflicts: string[] };

async function send(body: Record<string, unknown>): Promise<Saved> {
  const res = await fetch("/api/processes/from-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(res.status === 409 ? "The process changed meanwhile. Reload and choose again." : `Saving failed (${res.status}).`);
  return (await res.json()) as Saved;
}

const percent = (n: number) => `${Math.round(n * 100)}%`;

export default function ProcessChoice({ sessionId }: { sessionId: string }) {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [hidden, setHidden] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [preview, setPreview] = useState<Saved | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/processes/from-session?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" }).then(
      async (res) => {
        if (!live) return;
        if (!res.ok) return setHidden(true);
        const s = (await res.json()) as Suggestion;
        if (!live) return;
        setSuggestion(s);
        setTarget(s.match.choice !== "new" ? s.match.choice : (s.candidates[0]?.id ?? ""));
      },
      () => live && setHidden(true),
    );
    return () => {
      live = false;
    };
  }, [sessionId]);

  // An agent without processes: the Work Map becomes its first process, nothing to ask.
  const firstProcess = suggestion !== null && !suggestion.linked && suggestion.candidates.length === 0;
  useEffect(() => {
    if (!firstProcess) return;
    let live = true;
    send({ session_id: sessionId, choice: "new" }).then(
      (r) => live && setSaved(r),
      (err: unknown) => live && setError(err instanceof Error ? err.message : String(err)),
    );
    return () => {
      live = false;
    };
  }, [firstProcess, sessionId]);

  if (hidden || !suggestion) return null;

  async function run(choice: Choice, asPreview = false) {
    setBusy(true);
    setError(null);
    try {
      const body = { session_id: sessionId, choice, ...(choice === "new" ? {} : { process_id: target }), ...(asPreview ? { preview: true } : {}) };
      const r = await send(body);
      if (asPreview) setPreview(r);
      else {
        setPreview(null);
        setSaved(r);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const card = "ui-card flex flex-col";
  const style = { padding: 22, gap: 14 } as const;

  if (suggestion.linked)
    return (
      <section className={card} style={style} data-testid="process-choice">
        <span className="text-[13px]" style={{ color: "var(--mu)" }}>
          Saved in the process &ldquo;{suggestion.linked.title}&rdquo; (version {suggestion.linked.version}).
        </span>
      </section>
    );

  if (saved)
    return (
      <section className={card} style={style} data-testid="process-choice" role="status">
        <span className="ui-bdg ui-k-ok self-start">
          {saved.process ? `Saved in “${saved.process.title}” · version ${saved.process.version}` : "Saved"}
        </span>
        {saved.changes.length > 0 && (
          <ul className="text-[13px]" style={{ color: "var(--mu)", paddingLeft: 18 }}>
            {saved.changes.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
        {saved.conflicts.length > 0 && <p className="text-[13px]" style={{ color: "var(--am)" }}>{saved.conflicts.length} open question(s) added for you to settle.</p>}
      </section>
    );

  if (firstProcess)
    return error ? <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>{error}</p> : null;

  const current = suggestion.candidates.find((c) => c.id === target) ?? null;
  const suggested = suggestion.match.choice !== "new" ? suggestion.match : null;

  return (
    <section className={card} style={style} data-testid="process-choice">
      <h2 className="ui-t3">Save this process</h2>
      <p style={{ fontSize: 15 }}>
        {suggested
          ? `This looks like “${suggested.title}” (${percent(suggested.confidence)} similar).`
          : "This looks like a new process for this agent."}
      </p>
      <label className="flex flex-wrap items-center text-[13px]" style={{ gap: 8, color: "var(--mu)" }}>
        Existing process
        <select className="ui-inp" value={target} onChange={(e) => { setTarget(e.target.value); setPreview(null); }} aria-label="Existing process">
          {suggestion.candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </label>
      {preview ? (
        <div className="flex flex-col" style={{ gap: 10 }} data-testid="merge-preview">
          <span className="text-[13px]">What changes in &ldquo;{current?.title}&rdquo;:</span>
          <ul className="text-[13px]" style={{ paddingLeft: 18 }}>
            {preview.changes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          {preview.conflicts.length > 0 && (
            <>
              <span className="text-[13px]" style={{ color: "var(--am)" }}>Conflicts, kept as open questions:</span>
              <ul className="text-[13px]" style={{ paddingLeft: 18, color: "var(--am)" }}>
                {preview.conflicts.map((c) => <li key={c}>{c}</li>)}
              </ul>
            </>
          )}
          <div className="flex flex-wrap" style={{ gap: 10 }}>
            <button type="button" disabled={busy} onClick={() => void run("add")} className={buttonClass("primary")}>Confirm and add</button>
            <button type="button" disabled={busy} onClick={() => setPreview(null)} className={buttonClass("ghost")}>Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap" style={{ gap: 10 }}>
          <button type="button" disabled={busy || !current} onClick={() => void run("add", true)} className={buttonClass(suggested ? "primary" : "secondary")}>
            Add to it
          </button>
          <button type="button" disabled={busy || !current} onClick={() => void run("replace")} className={buttonClass("secondary")}>
            Replace it
          </button>
          <button type="button" disabled={busy} onClick={() => void run("new")} className={buttonClass(suggested ? "secondary" : "primary")}>
            Save as a new process
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>{error}</p>}
    </section>
  );
}
