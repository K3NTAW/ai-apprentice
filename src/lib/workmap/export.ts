// Agent-ready export (docs/BUILD_SPEC.md section 13): instructions an agent can follow, every rule with its source quote.
import type { Guardrail, WorkMap } from "@/lib/types";

export function formatT(t: number): string {
  const s = Math.max(0, Math.round(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

const quoted = (quote: string | undefined, t: number) => (quote ? ` Expert: "${quote}" [${formatT(t)}]` : ` [${formatT(t)}]`);

export function exportGuardrailsMarkdown(workmap: WorkMap): string {
  const lines: string[] = [];
  lines.push(`# Agent instructions: ${workmap.task}`, "");
  lines.push(`Learned from ${workmap.expert}. Confirmed by expert: ${workmap.confirmed_by_expert ? "yes" : "no"}.`, "");

  lines.push("## Steps", "");
  if (!workmap.steps.length) lines.push("No steps captured yet.");
  for (const step of workmap.steps) {
    const m = step.screen_moment;
    const where = `${m.app ? `${m.app}: ` : ""}${m.entity}${m.field ? `, ${m.field.replace(/_/g, " ")}` : ""} [${formatT(m.t)}]`;
    lines.push(`${step.n}. **${step.title}**: ${step.decision} (${where})`);
    if (step.reason) lines.push(`   - Why: "${step.reason.quote}" [${formatT(step.reason.t)}, ${step.reason.source.replace(/_/g, " ")}]`);
    else lines.push("   - Why: not stated by the expert.");
  }
  lines.push("");

  const all: (Guardrail & { step: number })[] = workmap.steps.flatMap((s) => s.guardrails.map((g) => ({ ...g, step: s.n })));
  const never = all.filter((g) => g.kind !== "stop_and_ask");
  const stop = all.filter((g) => g.kind === "stop_and_ask");

  lines.push("## Guardrails (never break)", "");
  if (!never.length) lines.push("- None captured.");
  for (const g of never) {
    const tag = g.kind === "exception" ? "Exception: " : "";
    lines.push(`- ${tag}${g.rule} (step ${g.step}).${quoted(g.quote, g.quote_ref)}`);
  }
  lines.push("");

  lines.push("## Stop and ask a human when", "");
  for (const g of stop) lines.push(`- ${g.rule} (step ${g.step}).${quoted(g.quote, g.quote_ref)}`);
  lines.push("- Anything is not covered by the steps and guardrails above.");

  if (workmap.open_questions.length) {
    lines.push("", "## Open questions", "");
    for (const q of workmap.open_questions) lines.push(`- ${q}`);
  }
  return `${lines.join("\n")}\n`;
}
