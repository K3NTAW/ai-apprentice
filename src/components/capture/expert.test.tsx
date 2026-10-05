// Demo residue cleanup (T-0289): no default expert name. An empty field blocks Start with an inline prompt; the
// agent's expert_name prefills the field.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CaptureConsole, { type CaptureConsoleProps } from "./CaptureConsole";
import SidePanel from "./SidePanel";
import { EXPERT_PROMPT, prefillExpert, startExpert } from "./sessionControls";

const noop = () => {};
function props(over: Partial<CaptureConsoleProps> = {}): CaptureConsoleProps {
  return {
    running: false,
    starting: false,
    offRecord: false,
    sharing: false,
    shareWarning: null,
    expert: "",
    lastQuestion: null,
    asked: 0,
    guardrailAsked: 0,
    savedForDebrief: 0,
    feed: [],
    companion: { status: "not connected", permissions: null, onPair: () => true },
    onExpertChange: noop,
    onStart: noop,
    onEnd: noop,
    onTogglePause: noop,
    onToggleOffRecord: noop,
    onToggleShare: noop,
    ...over,
  };
}

const startButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*>Start<\/button>/)?.[0] ?? "";

describe("expert name", () => {
  it("empty: Start is disabled, the field is focused and the console asks who the expert is", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props()} />);
    expect(html).toContain(EXPERT_PROMPT);
    expect(html).toContain('data-testid="expert-prompt"');
    expect(html).toMatch(/<input[^>]*autofocus=""[^>]*aria-invalid="true"/i);
    expect(startButton(html)).toContain('disabled=""');
  });

  it("whitespace only counts as empty", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props({ expert: "   " })} />);
    expect(html).toContain(EXPERT_PROMPT);
    expect(startButton(html)).toContain('disabled=""');
    expect(startExpert("   ")).toBeNull();
  });

  it("a name enables Start and hides the prompt", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props({ expert: "Ana Expert" })} />);
    expect(html).not.toContain(EXPERT_PROMPT);
    expect(startButton(html)).not.toContain('disabled=""');
    expect(startExpert("  Ana Expert ")).toBe("Ana Expert");
  });

  it("the side panel blocks Start the same way", () => {
    const side = (expert: string) =>
      renderToStaticMarkup(
        <SidePanel
          status="idle"
          running={false}
          starting={false}
          offRecord={false}
          textMode={false}
          sharing={false}
          notice={null}
          expert={expert}
          lastQuestion={null}
          openQuestion={null}
          asked={0}
          guardrailAsked={0}
          savedForDebrief={0}
          feed={[]}
          onExpertChange={noop}
          onStart={noop}
          onEnd={noop}
          onTogglePause={noop}
          onToggleShare={noop}
          onAnswer={noop}
        />,
      );
    expect(side("")).toContain(EXPERT_PROMPT);
    expect(side("")).toMatch(/<button[^>]*disabled=""[^>]*>Start session/);
    expect(side("Ana")).not.toContain(EXPERT_PROMPT);
  });

  it("the agent's expert_name prefills the field; without one the field keeps its value", () => {
    expect(prefillExpert("", "Ana Expert")).toBe("Ana Expert");
    expect(prefillExpert("typed", " Ana Expert ")).toBe("Ana Expert");
    expect(prefillExpert("typed", null)).toBe("typed");
    expect(prefillExpert("", undefined)).toBe("");
    expect(prefillExpert("", "  ")).toBe("");
  });

  it("CaptureApp starts empty, adopts the agent's name and has no fallback name", () => {
    const src = readFileSync(join(__dirname, "CaptureApp.tsx"), "utf8");
    expect(src).not.toMatch(/Sabine/);
    expect(src).toMatch(/const \[expert, setExpert\] = useState\(""\)/);
    expect(src).toMatch(/setExpert\(\(current\) => prefillExpert\(current, agentExpert\)\)/);
    expect(src).toMatch(/const name = startExpert\(expert\);\n\s*if \(!name\) return;/);
  });
});
