// Teach console chat thread and composer (design V3, canvas Teach.dc.html): the transcript is a chat thread and
// a typed message in the input box is sent to the tutor as a text turn (voice mode) or scored as the answer (text mode).
import type { FormEvent, ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMAIL_FLOW_WORKMAP } from "@/lib/teach/fixtures";
import TeachConsole, { Composer, type TeachConsoleProps, type TeachLine } from "./TeachConsole";
import { sendTextTurn, textTurnError, TUTOR_DISCONNECTED } from "./textTurn";

const lines: TeachLine[] = [
  { id: "1", speaker: "tutor", text: "Have a look at the amount first." },
  { id: "2", speaker: "learner", text: "Seven thousand two hundred." },
];

const base: TeachConsoleProps = {
  options: [{ id: "cap_1", label: "Email flow" }],
  selected: "cap_1",
  workmap: EMAIL_FLOW_WORKMAP,
  banner: null,
  workmapSessionId: "cap_1",
  running: true,
  starting: false,
  paused: false,
  sharing: false,
  shareWarning: null,
  notice: null,
  textMode: false,
  companion: { status: "paired", permissions: { input: true, screen: true, accessibility: true }, onPair: () => true },
  host: "bridge",
  currentStep: EMAIL_FLOW_WORKMAP.steps[1],
  transcript: lines,
  intervention: null,
  replayOpen: false,
  stats: { interventions: 0, active: 0, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false },
  result: null,
  onSelect: () => {},
  onStart: () => {},
  onToggleShare: () => {},
  onTogglePause: () => {},
  onEnd: () => {},
  onReplay: () => {},
  onAnswer: () => {},
};

/** Submits the composer form the way React would, with an input holding `value`. */
function submit(el: ReactElement, value: string) {
  const input = { value };
  const form = el as ReactElement<{ onSubmit(e: FormEvent<HTMLFormElement>): void }>;
  form.props.onSubmit({ preventDefault() {}, currentTarget: { elements: { namedItem: () => input } } } as unknown as FormEvent<HTMLFormElement>);
  return input;
}

describe("teach chat thread", () => {
  it("renders the transcript as a chat thread: tutor bubbles left, learner bubbles right, canvas copy", () => {
    const html = renderToStaticMarkup(<TeachConsole {...base} />);
    expect(html).toContain('data-testid="chat-thread"');
    expect(html).toContain("Tutor transcript");
    expect(html).toMatch(/data-speaker="tutor"[^>]*>.*Have a look at the amount first\./);
    expect(html).toMatch(/data-speaker="learner" style="border-radius:22px 22px 6px 22px;background:var\(--s3\)[^"]*align-self:flex-end/);
    expect(html.indexOf("Have a look")).toBeLessThan(html.indexOf("Seven thousand"));
    expect(html).toContain('placeholder="Answer out loud, or type here"');
    expect(html).toContain('aria-label="Send"');
    expect(html).toContain("border-radius:26px;background:var(--cmp)");
  });

  it("typing in the input box sends a text turn to the tutor", () => {
    const promptTurn = vi.fn();
    const push = vi.fn();
    const onLearner = vi.fn();
    const target = { textMode: false, voiceStatus: "connected", promptTurn };
    const el = Composer({ enabled: true, error: null, onSend: (t) => sendTextTurn(t, target, push, onLearner) });
    const input = submit(el, "  Because it is over five thousand?  ");
    expect(promptTurn).toHaveBeenCalledWith("Because it is over five thousand?");
    expect(push).toHaveBeenCalledWith("learner", "Because it is over five thousand?");
    expect(onLearner).toHaveBeenCalledWith("Because it is over five thousand?");
    expect(input.value).toBe("");
    submit(el, "   ");
    expect(promptTurn).toHaveBeenCalledTimes(1);
  });

  it("text mode: the typed answer is scored locally, no voice turn", () => {
    const promptTurn = vi.fn();
    const push = vi.fn();
    expect(sendTextTurn("capex", { textMode: true, voiceStatus: null, promptTurn }, push, () => {})).toBe(true);
    expect(promptTurn).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("learner", "capex");
  });

  it("disconnected tutor: input disabled with an error, the message is not dropped silently", () => {
    const promptTurn = vi.fn();
    const push = vi.fn();
    expect(sendTextTurn("hello", { textMode: false, voiceStatus: "disconnected", promptTurn }, push, () => {})).toBe(false);
    expect(promptTurn).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
    expect(textTurnError({ textMode: false, voiceStatus: "disconnected" })).toBe(TUTOR_DISCONNECTED);
    const html = renderToStaticMarkup(<TeachConsole {...base} sendError={TUTOR_DISCONNECTED} />);
    expect(html).toMatch(/<input id="teach-reply"[^>]*disabled/);
    expect(html).toContain('role="alert"');
    expect(html).toContain("The tutor is not connected, so your message was not sent.");
  });
});
