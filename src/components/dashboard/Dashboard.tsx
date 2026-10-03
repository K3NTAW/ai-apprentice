// Control room: captured workflows per expert, learners and their mastery, quick actions.
import Link from "next/link";
import type { Role } from "@/lib/auth/context";
import type { DashboardSummary, MasteryRow, WorkflowStatus } from "@/lib/dashboard/summary";
import { canCapture } from "@/components/shell/ShellHeader";
import HideInApp from "@/components/shell/HideInApp";

export type QuickAction = { href: string; label: string; primary?: boolean; browserOnly?: boolean };

/**
 * Quick actions for a role. browserOnly ones (the desktop app install link, /capture#companion) are left out
 * inside the desktop app; the page renders them through HideInApp, which decides that after mount.
 */
export function quickActions(role: Role | null, { inApp = false }: { inApp?: boolean } = {}): QuickAction[] {
  const all: QuickAction[] = [
    ...(canCapture(role) ? [{ href: "/capture", label: "Start a capture", primary: true }] : []),
    { href: "/teach", label: "Start tutoring" },
    { href: "/workspace", label: "Invite a colleague" },
    { href: "/capture#companion", label: "Install the desktop companion", browserOnly: true },
  ];
  return inApp ? all.filter((a) => !a.browserOnly) : all;
}

const STATUS_STYLE: Record<WorkflowStatus, string> = {
  capturing: "bg-sky-100 text-sky-800",
  "debrief pending": "bg-amber-100 text-amber-800",
  confirmed: "bg-green-100 text-green-800",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function MasteryLine({ row }: { row: MasteryRow }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span>
        Mastered: {row.mastered.length ? row.mastered.join(", ") : "none yet"}
        {" · "}Practice next: {row.practiceNext.length ? row.practiceNext.join(", ") : "nothing"}
        {" · "}Interventions: {row.interventions}
      </span>
      <span className="font-mono text-xs text-slate-500">
        {row.date}
        {!row.finished && " (in progress)"}
      </span>
    </span>
  );
}

export default function Dashboard({ summary, role }: { summary: DashboardSummary; role: Role | null }) {
  const { experts, learners } = summary;
  return (
    <main className="flex flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Captured workflows">
          {experts.length === 0 ? (
            <p className="text-sm text-slate-500">
              No captures yet. Open{" "}
              <Link className="underline" href="/capture">
                Capture
              </Link>
              , share your whole screen and do the task as usual while the apprentice watches and asks. The debrief then
              turns it into a Work Map for the expert to confirm.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {experts.map((e) => (
                <li key={e.expert} className="flex flex-col gap-1">
                  <span className="font-medium">{e.expert}</span>
                  <ul className="flex flex-col divide-y divide-slate-100">
                    {e.workflows.map((w) => (
                      <li key={w.sessionId}>
                        <Link href={w.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 hover:bg-slate-50">
                          <span>{w.task}</span>
                          <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[w.status]}`}>{w.status}</span>
                          {w.counts && <span className="text-slate-600">{w.counts}</span>}
                          <span className="ml-auto font-mono text-xs text-slate-500">{w.updated}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Learners">
          {learners.length === 0 ? (
            <p className="text-sm text-slate-500">
              No learners yet.{" "}
              <Link className="underline" href="/workspace">
                Invite a colleague
              </Link>{" "}
              with the learner role to practise a confirmed Work Map with the tutor.
            </p>
          ) : (
            <ul className="flex flex-col gap-3 text-sm">
              {learners.map((l) => (
                <li key={l.userId} className="flex flex-col gap-1">
                  <span className="font-medium">{l.label}</span>
                  {l.mastery.length === 0 ? (
                    <span className="text-slate-500">No tutoring on a confirmed Work Map yet.</span>
                  ) : (
                    <ul className="flex flex-col gap-1.5">
                      {l.mastery.map((m) => (
                        <li key={m.workmapSessionId} className="flex flex-col gap-0.5">
                          <Link className="underline" href={`/map/${encodeURIComponent(m.workmapSessionId)}`}>
                            {m.task}
                          </Link>
                          <MasteryLine row={m} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Quick actions">
          <div className="flex flex-wrap gap-2 text-sm">
            {quickActions(role).map((a) => {
              const link = (
                <Link
                  key={a.href}
                  className={a.primary ? "rounded bg-slate-900 px-3 py-1.5 text-white" : "rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50"}
                  href={a.href}
                >
                  {a.label}
                </Link>
              );
              return a.browserOnly ? <HideInApp key={a.href}>{link}</HideInApp> : link;
            })}
          </div>
        </Card>
      </div>
    </main>
  );
}
