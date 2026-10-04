"use client";
// Agent settings tab, 1:1 with the settings tab of docs/design/canvas/Agent.dc.html (AgentSettings.dc.html imports it):
// Identity, Questions while training, Privacy, Delete <agent>. Identity saves with PATCH /api/agents/[id] on blur or
// Save; every other control saves its own key with PATCH /api/agents/[id]/settings (merge patch).
// Owners and experts edit; Privacy is owner only. Owners delete (typed name), everyone else requests deletion.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Button, Card, Input, Label, buttonClass } from "@/components/ui";
import {
  DEFAULT_SETTINGS,
  OFF_RECORD_MAX,
  QUESTION_INTERVALS_S,
  RETENTION_DAYS,
  VOICE_PRESETS,
  intervalLabel,
  presetLabel,
  retentionLabel,
  speedLabel,
  type AgentSettings as Settings,
  type AgentSettingsPatch,
} from "@/lib/agents/settings";
import type { Role } from "@/lib/auth/context";
import { AGENT_EXPERT_NAME_MAX, AGENT_NAME_MAX, AGENT_ROLE_MAX, type Agent } from "@/lib/types";

export const canEditAgent = (role: Role | null) => role === "owner" || role === "expert";
export const canDeleteAgent = (role: Role | null) => role === "owner";
export const canEditPrivacy = (role: Role | null) => role === "owner";
/** Owner Delete asks for the typed agent name (see the dialog below). */
export const DELETE_CONFIRM = "Delete this agent? Type its name to confirm. Teach results are kept as a report.";
export const SPEEDS = [0.8, 0.9, 1, 1.1, 1.2] as const;
export const deleteText = (name: string, workMaps: number) =>
  `Removes ${name}, its ${workMaps} Work Map${workMaps === 1 ? "" : "s"} and all screen moments. Learner progress is kept as a report. This needs the workspace owner's approval.`;

const ROW: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  padding: "14px 0",
  borderTop: "1px solid var(--ln)",
  flexWrap: "wrap",
};
const PILL: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 10,
  background: "var(--s2)",
  border: "1px solid var(--ln2)",
  color: "var(--tx)",
  fontSize: 13,
};

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div style={ROW}>
      <span>
        <span style={{ display: "block" }}>{label}</span>
        {hint && (
          <span className="text-xs" style={{ color: "var(--fa)" }}>
            {hint}
          </span>
        )}
      </span>
      {children}
    </div>
  );
}

function Switch({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="relative flex-none cursor-pointer p-0 disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        width: 40,
        height: 24,
        borderRadius: 99,
        background: on ? "var(--ac)" : "var(--s3)",
        border: `1px solid ${on ? "var(--ac)" : "var(--ln2)"}`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute"
        style={{ top: 3, left: on ? 19 : 3, width: 16, height: 16, borderRadius: "50%", background: on ? "#fff" : "var(--mu)" }}
      />
    </button>
  );
}

function Select<T extends string | number>({
  label,
  value,
  options,
  text,
  disabled,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  text: (v: T) => string;
  disabled?: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <select
      aria-label={label}
      className="ui-mono"
      style={PILL}
      value={String(value)}
      disabled={disabled}
      onChange={(e) => onChange(options.find((o) => String(o) === e.target.value) as T)}
    >
      {options.map((o) => (
        <option key={String(o)} value={String(o)}>
          {text(o)}
        </option>
      ))}
    </select>
  );
}

type Notice = { ok: boolean; text: string } | null;

function Status({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p role="status" className="text-[13px]" style={{ color: notice.ok ? "var(--mu)" : "var(--rd)" }}>
      {notice.text}
    </p>
  );
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return body.message ?? (body.error ? `${fallback} (${body.error}).` : `${fallback} (${res.status}).`);
}

export type Identity = { name: string; role: string; expert: string };

/** PATCH /api/agents/[id] with name, role and expert_name (empty expert clears it). Inline success or error text. */
export async function patchIdentity(url: string, next: Identity): Promise<{ ok: boolean; text: string }> {
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: next.name, role: next.role, expert_name: next.expert || null }),
    });
    return res.ok ? { ok: true, text: "Saved." } : { ok: false, text: await errorText(res, "Could not save") };
  } catch {
    return { ok: false, text: "Could not save. Check the connection." };
  }
}

export const canConfirmDelete = (typed: string, name: string) => typed.trim() === name;

export default function AgentSettings({ agent, role, workMaps = 0 }: { agent: Agent; role: Role | null; workMaps?: number }) {
  const router = useRouter();
  const base = `/api/agents/${encodeURIComponent(agent.id)}`;
  const editable = canEditAgent(role);
  const privacy = canEditPrivacy(role);

  // Identity
  const [identity, setIdentity] = useState({ name: agent.name, role: agent.role, expert: agent.expert_name ?? "" });
  const [saved, setSaved] = useState(identity);
  const [idNotice, setIdNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  async function saveIdentity() {
    const next = { name: identity.name.trim(), role: identity.role.trim(), expert: identity.expert.trim() };
    if (next.name === saved.name && next.role === saved.role && next.expert === saved.expert) return;
    if (!next.name || !next.role) {
      setIdNotice({ ok: false, text: "Name and role cannot be empty." });
      return;
    }
    setBusy(true);
    const notice = await patchIdentity(base, next);
    if (notice.ok) {
      setSaved(next);
      router.refresh();
    }
    setIdNotice(notice);
    setBusy(false);
  }

  // Settings
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [setNotice, setSetNotice] = useState<Notice>(null);
  const [phrase, setPhrase] = useState(DEFAULT_SETTINGS.off_record_phrase);
  useEffect(() => {
    let live = true;
    fetch(`${base}/settings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { settings: Settings; available: boolean; message?: string } | null) => {
        if (!live || !b) return;
        setSettings(b.settings);
        setPhrase(b.settings.off_record_phrase);
        if (!b.available && b.message) setSetNotice({ ok: false, text: b.message });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [base]);

  async function patch(p: AgentSettingsPatch) {
    const before = settings;
    setSettings({ ...settings, ...p });
    try {
      const res = await fetch(`${base}/settings`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(p),
      });
      if (res.ok) {
        const b = (await res.json()) as { settings: Settings };
        setSettings(b.settings);
        setSetNotice({ ok: true, text: "Saved." });
      } else {
        setSettings(before);
        setSetNotice({ ok: false, text: await errorText(res, "Could not save") });
      }
    } catch {
      setSettings(before);
      setSetNotice({ ok: false, text: "Could not save. Check the connection." });
    }
  }

  function savePhrase() {
    const v = phrase.trim();
    if (v === settings.off_record_phrase) return;
    if (!v) {
      setPhrase(DEFAULT_SETTINGS.off_record_phrase);
      void patch({ off_record_phrase: DEFAULT_SETTINGS.off_record_phrase });
      return;
    }
    void patch({ off_record_phrase: v });
  }

  // Delete
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [delNotice, setDelNotice] = useState<Notice>(null);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(base, { method: "DELETE" });
      if (res.ok) router.push("/agents");
      else setDelNotice({ ok: false, text: await errorText(res, "Could not delete") });
    } catch {
      setDelNotice({ ok: false, text: "Could not delete. Check the connection." });
    } finally {
      setBusy(false);
    }
  }

  async function requestDeletion() {
    setBusy(true);
    try {
      const res = await fetch(`${base}/deletion`, { method: "POST" });
      setDelNotice(res.ok ? { ok: true, text: "Deletion requested. The workspace owner decides on the Workspace page." } : { ok: false, text: await errorText(res, "Could not request deletion") });
    } catch {
      setDelNotice({ ok: false, text: "Could not request deletion. Check the connection." });
    } finally {
      setBusy(false);
    }
  }

  const s = settings;
  return (
    <div className="grid items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16 }}>
      <Card className="flex flex-col" style={{ padding: 24, gap: 16 }}>
        <h2 className="ui-t3">Identity</h2>
        <div>
          <Label htmlFor="set-name">Name</Label>
          <Input id="set-name" type="text" value={identity.name} maxLength={AGENT_NAME_MAX} disabled={!editable} onChange={(e) => setIdentity({ ...identity, name: e.target.value })} onBlur={() => void saveIdentity()} />
        </div>
        <div>
          <Label htmlFor="set-role">Role</Label>
          <Input id="set-role" type="text" value={identity.role} maxLength={AGENT_ROLE_MAX} disabled={!editable} onChange={(e) => setIdentity({ ...identity, role: e.target.value })} onBlur={() => void saveIdentity()} />
        </div>
        <div>
          <Label htmlFor="set-expert">Expert</Label>
          <Input id="set-expert" type="text" value={identity.expert} maxLength={AGENT_EXPERT_NAME_MAX} disabled={!editable} onChange={(e) => setIdentity({ ...identity, expert: e.target.value })} onBlur={() => void saveIdentity()} />
        </div>
        {editable && (
          <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
            <Link className={buttonClass("secondary", "sm")} href={`/agents/${encodeURIComponent(agent.id)}/studio`}>
              Edit avatar
            </Link>
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void saveIdentity()}>
              Save
            </Button>
          </div>
        )}
        <Status notice={idNotice} />
      </Card>

      <Card className="flex flex-col" style={{ padding: 24, gap: 4 }}>
        <h2 className="ui-t3" style={{ marginBottom: 8 }}>
          Questions while training
        </h2>
        <Row label="At most one question every" hint="Pauses shorter than 4 s never trigger a question">
          <Select label="At most one question every" value={s.question_interval_s} options={QUESTION_INTERVALS_S} text={intervalLabel} disabled={!editable} onChange={(v) => void patch({ question_interval_s: v })} />
        </Row>
        <Row label="Ask about guardrails first">
          <Switch label="Ask about guardrails first" on={s.guardrails_first} disabled={!editable} onChange={(v) => void patch({ guardrails_first: v })} />
        </Row>
        <Row label="Learn keyboard shortcuts">
          <Switch label="Learn keyboard shortcuts" on={s.learn_shortcuts} disabled={!editable} onChange={(v) => void patch({ learn_shortcuts: v })} />
        </Row>
        <Row label="Voice">
          <span className="flex items-center" style={{ gap: 8 }}>
            <Select label="Voice" value={s.voice_preset} options={VOICE_PRESETS} text={presetLabel} disabled={!editable} onChange={(v) => void patch({ voice_preset: v })} />
            <Select label="Voice speed" value={s.voice_speed} options={SPEEDS} text={speedLabel} disabled={!editable} onChange={(v) => void patch({ voice_speed: v })} />
          </span>
        </Row>
      </Card>

      <Card className="flex flex-col" style={{ padding: 24, gap: 4 }}>
        <h2 className="ui-t3" style={{ marginBottom: 8 }}>
          Privacy
        </h2>
        <Row label="Redact names and email addresses">
          <Switch label="Redact names and email addresses" on={s.redact_names_emails} disabled={!privacy} onChange={(v) => void patch({ redact_names_emails: v })} />
        </Row>
        <Row label="Redact IBANs and phone numbers">
          <Switch label="Redact IBANs and phone numbers" on={s.redact_iban_phone} disabled={!privacy} onChange={(v) => void patch({ redact_iban_phone: v })} />
        </Row>
        <Row label="Off the record phrase" hint="Also works with the button or ⌥⇧O">
          <input
            aria-label="Off the record phrase"
            className="ui-mono text-[13px]"
            style={{ ...PILL, width: 180 }}
            value={phrase}
            maxLength={OFF_RECORD_MAX}
            disabled={!privacy}
            onChange={(e) => setPhrase(e.target.value)}
            onBlur={savePhrase}
          />
        </Row>
        <Row label="Keep screen moments for">
          <Select label="Keep screen moments for" value={s.retention_days} options={RETENTION_DAYS} text={retentionLabel} disabled={!privacy} onChange={(v) => void patch({ retention_days: v })} />
        </Row>
        <Status notice={setNotice} />
      </Card>

      <Card className="flex flex-col" style={{ padding: 24, gap: 12, borderColor: "var(--rds)" }}>
        <h2 className="ui-t3">Delete {agent.name}</h2>
        <p className="text-[13px]" style={{ color: "var(--mu)" }}>
          {deleteText(agent.name, workMaps)}
        </p>
        {canDeleteAgent(role) ? (
          <Button variant="danger" size="sm" className="self-start" aria-label="Delete agent" disabled={busy} onClick={() => setConfirming(true)}>
            Delete
          </Button>
        ) : (
          <Button variant="danger" size="sm" className="self-start" disabled={busy} onClick={() => void requestDeletion()}>
            Request deletion
          </Button>
        )}
        {confirming && (
          <div role="dialog" aria-modal="true" aria-labelledby="del-title" className="flex flex-col" style={{ gap: 10, paddingTop: 12, borderTop: "1px solid var(--ln)" }}>
            <h3 id="del-title" className="text-sm font-medium">
              Type {agent.name} to delete it
            </h3>
            <Input aria-label="Agent name" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
            <div className="flex" style={{ gap: 8 }}>
              <Button variant="danger" size="sm" disabled={busy || !canConfirmDelete(typed, agent.name)} onClick={() => void remove()}>
                Delete {agent.name}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfirming(false); setTyped(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        <Status notice={delNotice} />
      </Card>
    </div>
  );
}
