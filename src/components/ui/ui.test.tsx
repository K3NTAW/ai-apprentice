import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BADGE_KINDS,
  Badge,
  BUTTON_VARIANTS,
  Button,
  Card,
  Chord,
  CodeInput,
  DOT_STATES,
  EmptyState,
  FeedRow,
  Halo,
  Input,
  Label,
  Quote,
  ScoreBar,
  SpeechBubble,
  Tabs,
  TimelineDot,
  Toast,
  type BadgeKind,
} from "./index";

const html = (el: React.ReactElement) => renderToStaticMarkup(el);

describe("ui components (Components.dc.html)", () => {
  it("buttons: primary (white), secondary, ghost, danger, icon, in three sizes", () => {
    const cls = { primary: "ui-bp", secondary: "ui-bs", ghost: "ui-bg", danger: "ui-bd", icon: "ui-bi" };
    for (const v of BUTTON_VARIANTS) expect(html(<Button variant={v}>x</Button>)).toContain(cls[v]);
    expect(html(<Button size="sm">x</Button>)).toContain("ui-bsm");
    expect(html(<Button size="lg">x</Button>)).toContain("ui-bl");
    expect(html(<Button>x</Button>)).toContain('type="button"');
    expect(html(<Button disabled>x</Button>)).toContain("disabled");
  });

  it("inputs and label", () => {
    const out = html(
      <>
        <Label htmlFor="e">Work email</Label>
        <Input id="e" type="email" placeholder="name@company.com" />
      </>,
    );
    expect(out).toContain('class="ui-lbl"');
    expect(out).toContain('class="ui-inp"');
  });

  it("6-digit code input with the separator after the third digit", () => {
    const out = html(<CodeInput value="482" />);
    expect(out.match(/class="ui-code"/g)).toHaveLength(6);
    for (let i = 1; i <= 6; i++) expect(out).toContain(`aria-label="Digit ${i}"`);
    expect(out).toContain('value="4"');
    expect(out.indexOf("·")).toBeGreaterThan(out.indexOf('aria-label="Digit 3"'));
    expect(out.indexOf("·")).toBeLessThan(out.indexOf('aria-label="Digit 4"'));
  });

  it("tabs mark the active one", () => {
    const out = html(<Tabs active="p" tabs={[{ id: "p", label: "Processes", count: 6 }, { id: "s", label: "Shortcuts" }]} />);
    expect(out).toContain("ui-tab ui-on");
    expect(out).toContain('aria-selected="true"');
    expect(out).toContain("Shortcuts");
  });

  it("badges: confirmed, not yet confirmed, limit, exception, stop and ask, judgment call", () => {
    const want: Record<string, [string, string]> = {
      confirmed: ["ui-k-ok", "Confirmed"],
      pending: ["ui-k-pend", "Not yet confirmed"],
      limit: ["ui-k-lim", "Limit"],
      exception: ["ui-k-exc", "Exception"],
      stop_and_ask: ["ui-k-stop", "Stop and ask"],
      judgment: ["ui-k-jc", "Judgment call"],
    };
    for (const [k, [cls, label]] of Object.entries(want)) {
      const out = html(<Badge kind={k as BadgeKind} />);
      expect(out).toContain(cls);
      expect(out).toContain(label);
    }
    expect(Object.keys(BADGE_KINDS)).toEqual(expect.arrayContaining(Object.keys(want)));
  });

  it("score bar: threshold tick, amber below the threshold", () => {
    const above = html(<ScoreBar label="Knows why" value={92} />);
    expect(above).toContain("width:92%");
    expect(above).toContain("left:75%");
    expect(above).not.toContain("ui-lo");
    expect(html(<ScoreBar label="Knows when to stop" value={68} />)).toContain('class="ui-lo"');
  });

  it("timeline dot states", () => {
    for (const s of DOT_STATES) expect(html(<TimelineDot state={s} label={s} />)).toContain(`ui-dot-${s}`);
  });

  it("speech bubbles; the expert bubble is the italic serif", () => {
    expect(html(<SpeechBubble meta="Pip · at a pause">Why?</SpeechBubble>)).toContain('class="ui-bub"');
    const expert = html(<SpeechBubble from="expert">Equipment over €5,000 is always capex.</SpeechBubble>);
    expect(expert).toContain("ui-bub-expert");
    expect(expert).toContain("ui-qs");
  });

  it("halo, toast, cards, empty state", () => {
    expect(html(<Halo />)).toContain("ui-halo");
    const toast = html(<Toast action={{ label: "Undo", onClick: () => {} }}>Work Map confirmed.</Toast>);
    expect(toast).toContain('role="status"');
    expect(toast).toContain("Undo");
    expect(html(<Card>x</Card>)).toContain('class="ui-card"');
    expect(html(<Card dashed>x</Card>)).toContain("ui-card-dashed");
    const empty = html(<EmptyState title="No agents yet" text="An agent learns from one expert." action={<Button size="sm">Create your first agent</Button>} />);
    expect(empty).toContain("ui-t3");
    expect(empty).toContain("Create your first agent");
  });

  it("keycap chord and feed row", () => {
    const chord = html(<Chord keys={["⌘", "⇧", "T"]} />);
    expect(chord.match(/class="ui-kc"/g)).toHaveLength(3);
    const row = html(
      <FeedRow time="14:05:22" app="Sabine" color="var(--ac)" trailing={<Badge kind="limit" />}>
        Equipment over €5,000 is always capex.
      </FeedRow>,
    );
    expect(row).toContain('class="ui-ev"');
    expect(row).toContain("ui-mono");
    expect(row).toContain("ui-k-lim");
  });

  it("quotes use the italic serif class", () => {
    const out = html(<Quote>Equipment over €5,000 is always capex.</Quote>);
    expect(out).toContain('class="ui-qs"');
    expect(out).toContain("font-size:34px");
  });
});
