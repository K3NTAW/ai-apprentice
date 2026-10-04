// Teach-back: spoken summary of the Work Map the expert confirms. Deterministic template, no LLM.
import type { WorkMap, WorkMapStep } from "@/lib/types";

export const TEACHBACK_MAX_WORDS = 130;
const OPENER = "Here is what I learned.";
const CLOSER = "Did I get that right?";

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const countWords = (s: string) => words(s).length;
const clip = (s: string, max: number) => {
  const w = words(s.replace(/[.!?\s]+$/, ""));
  return w.length <= max ? w.join(" ") : w.slice(0, max).join(" ");
};
const lowerFirst = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);

function stepSentence(step: WorkMapStep, i: number, total: number, max: number): string {
  const lead = i === 0 ? "First you" : i === total - 1 ? "Finally you" : "Then you";
  let s = `${lead} ${lowerFirst(clip(step.decision || step.title, max))}`;
  const rules = step.guardrails.map((g) => clip(lowerFirst(g.rule), max));
  if (rules.length) s += `, and the rule is ${rules.join(" and ")}`;
  return `${s}.`;
}

export function teachBackText(workmap: WorkMap): string {
  const steps = workmap.steps;
  if (!steps.length) return `I have not learned any steps yet. ${CLOSER}`;
  // Shrink every clause until the whole text fits; drop trailing steps only as a last resort.
  for (let keep = steps.length; keep >= 1; keep--) {
    const shown = steps.slice(0, keep);
    for (let max = 20; max >= 3; max--) {
      const body = shown.map((s, i) => stepSentence(s, i, shown.length, max));
      const text = [OPENER, ...body, CLOSER].join(" ");
      if (countWords(text) < TEACHBACK_MAX_WORDS) return text;
    }
  }
  return `${OPENER} ${CLOSER}`;
}
