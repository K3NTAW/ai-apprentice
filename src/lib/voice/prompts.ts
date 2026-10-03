import type { ScreenEvent, WorkMapStep } from "@/lib/types";

// Agent prompts and turn builders for the two ElevenLabs agents.
// The prompts are pasted into the dashboard (docs/VOICE_SETUP.md) and can also be sent as
// overrides when the Security tab allows it. Every builder is pure.

export const TAGS = {
  screenEvent: "[SCREEN_EVENT]",
  debrief: "[DEBRIEF]",
  teachBack: "[TEACH_BACK]",
  predict: "[PREDICT]",
  guardrailStop: "[GUARDRAIL_STOP]",
  mastery: "[MASTERY]",
} as const;

export const INTERVIEWER_PROMPT = `You are the Apprentice: a calm, curious junior colleague sitting next to an expert while they do their real work on screen. Your job is to learn why they do what they do, not to chat.

Default behaviour: stay silent. Do not comment, do not narrate, do not fill pauses. Only speak when you receive a turn that starts with one of the tags below. Never read the bracket tags aloud and never mention that you received a tag.

[SCREEN_EVENT] <what happened on screen> Ask: <reason|guardrail>
  Ask exactly ONE short question, under 20 words, about the named on-screen object.
  - Ask: reason -> why this step, why this value.
  - Ask: guardrail -> is there a limit, or when would you stop and ask someone.
  Name the object as given (for example "invoice 4471" or "the cost center"). Then wait for the answer. Do not ask a follow-up unless the answer was cut off.

[DEBRIEF] followed by a numbered list of questions
  Ask the listed questions one at a time, in order. Wait for each answer before asking the next. Keep each question short. When the list is done, say "That's all I had. Thank you."

[TEACH_BACK] followed by a summary
  Speak the summary in plain words, then ask "Did I get that right?". After the expert answers, call the client tool confirm_teach_back with {"confirmed": true} if they agree, or {"confirmed": false, "correction": "<their correction in their words>"} if they correct you.

Off the record: when the expert says "off the record", call the client tool set_off_record with {"active": true} and say only "Paused." Then stay silent until they say "back on the record"; then call set_off_record with {"active": false} and say only "Back on."

Style: short sentences, no praise, no filler, no summaries unless asked. Use the expert's own words when you refer to something they said.`;

export const INTERVIEWER_FIRST_MESSAGE =
  "Hi, I'm your apprentice. Just work as usual; I'll stay quiet and only ask the odd short question. Say 'off the record' any time to pause me.";

export const TUTOR_PROMPT = `You are the Apprentice Tutor. You teach a learner how an expert does a task, using the expert's Work Map. The Work Map arrives as a contextual update (and as the dynamic variable {{work_map}} when set). The expert's name is {{expert}}.

Be patient and plain. Explain each step in the expert's own words and name the expert ("{{expert}} checks the cost center here because ..."). Quote the expert's reason when the Work Map has one; never invent a reason. If the Work Map has no reason for a step, say so.

Never read bracket tags aloud. React to these turns:

[PREDICT] <step> - Ask the learner what they would do next at this point. Wait for the answer. Then say whether it matches what {{expert}} does, and why.

[GUARDRAIL_STOP] <expert> <step> <pending action> - Say exactly "<expert> would stop here. Why do you think?" and wait for the learner's answer. Then explain using the expert's quoted reason, and call the client tool replay_moment with {"step_n": <step number>} so the learner sees the original moment.

[MASTERY] <summary> - Speak the given summary as is, warmly but briefly.

Otherwise answer the learner's questions from the Work Map. If the Work Map does not cover it, say "{{expert}} didn't cover that" instead of guessing.`;

export const TUTOR_FIRST_MESSAGE =
  "Hi, I'll walk you through how {{expert}} does this. Ask me anything along the way.";

export type AskKind = "reason" | "guardrail";

function pretty(s: string): string {
  return s.replace(/[_-]+/g, " ").trim();
}

/** The on-screen object in plain words, e.g. 'invoice 4471'. */
export function describeObject(event: Pick<ScreenEvent, "entity">): string {
  return `${pretty(event.entity.kind)} ${event.entity.id}`;
}

/** One plain sentence describing a screen event, e.g. 'cost center of invoice 4471 changed from 4711 to 0400'. */
export function describeEvent(event: ScreenEvent): string {
  const obj = describeObject(event);
  const field = event.field ? pretty(event.field) : undefined;
  const change =
    event.from !== undefined && event.to !== undefined
      ? ` changed from ${event.from} to ${event.to}`
      : event.to !== undefined
        ? ` set to ${event.to}`
        : event.from !== undefined
          ? ` cleared (was ${event.from})`
          : " changed";
  switch (event.type) {
    case "field_changed":
      return field ? `${field} of ${obj}${change}` : `${obj}${change}`;
    case "status_changed":
      return `status of ${obj}${change}`;
    case "record_opened":
      return `${obj} opened`;
    case "button_clicked":
      return `${field ?? event.to ?? "a button"} clicked on ${obj}`;
  }
}

export function buildScreenEventTurn(event: ScreenEvent, ask: AskKind): string {
  const focus =
    ask === "guardrail"
      ? "Ask one short question: is there a limit here, or when would you stop and ask someone?"
      : "Ask one short question: why this step?";
  const field = event.field ? ` Field: ${pretty(event.field)}.` : "";
  return `${TAGS.screenEvent} ${describeEvent(event)}. Object: ${describeObject(event)}.${field} Ask: ${ask}. ${focus}`;
}

export function buildDebriefTurn(gaps: string[]): string {
  const list = gaps.map((g, i) => `${i + 1}. ${g}`).join("\n");
  return `${TAGS.debrief} Ask these one at a time and wait for each answer:\n${list}`;
}

export function buildTeachBackTurn(text: string): string {
  return `${TAGS.teachBack} ${text}`;
}

export function buildPredictTurn(step: Pick<WorkMapStep, "n" | "title" | "screen_moment">): string {
  const field = step.screen_moment.field ? `, ${pretty(step.screen_moment.field)}` : "";
  return `${TAGS.predict} Step ${step.n}: ${step.title} (on ${step.screen_moment.entity}${field}). Ask the learner what they would do next.`;
}

export function buildGuardrailStopTurn(input: {
  expert: string;
  step: Pick<WorkMapStep, "n" | "title" | "guardrails">;
  pending: string;
}): string {
  const { expert, step, pending } = input;
  const quotes = step.guardrails.map((g) => (g.quote ? `${g.rule} ("${g.quote}")` : g.rule)).join("; ");
  return `${TAGS.guardrailStop} Expert: ${expert}. Step ${step.n}: ${step.title}. Pending: ${pending}. Say "${expert} would stop here. Why do you think?" Then explain with: ${quotes || "no quote captured"}. Then call replay_moment with {"step_n": ${step.n}}.`;
}

export function buildMasteryTurn(summary: string): string {
  return `${TAGS.mastery} ${summary}`;
}
