// Control room: captured workflows per expert, learners and their mastery, quick actions.
import Link from "next/link";
import type { Role } from "@/lib/auth/context";
import type { DashboardSummary, MasteryRow, WorkflowStatus } from "@/lib/dashboard/summary";
import { canCapture } from "@/components/shell/ShellHeader";

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
            {canCapture(role) && (
              <Link className="rounded bg-slate-900 px-3 py-1.5 text-white" href="/capture">
                Start a capture
              </Link>
            )}
            <Link className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/teach">
              Start tutoring
            </Link>
            <Link className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/workspace">
              Invite a colleague
            </Link>
            <Link className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50" href="/capture#companion">
              Install the desktop companion
            </Link>
          </div>
        </Card>
      </div>
    </main>
  );
}
