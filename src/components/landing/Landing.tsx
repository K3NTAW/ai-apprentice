// Public product landing page (Main.dc.html; LandingLight.dc.html is the same page under data-theme="light",
// LandingPhone.dc.html the narrow breakpoint). The CTA depends on the mode: 'Sign in' with Supabase,
// 'Open the app' in local mode.
import Link from "next/link";
import { Badge, buttonClass } from "@/components/ui";
import AgentAvatar from "@/components/agents/AgentAvatar";
import BrandMark from "./BrandMark";

export const STEPS = [
  {
    title: "Train",
    text: "The expert works as usual in any app. The agent stays quiet while they type and asks one short question when they pause.",
    foot: "3 asked · 1 about guardrails",
  },
  {
    title: "Map",
    text: "A short spoken debrief closes the gaps. The agent explains the process back, the expert confirms or corrects, and a Work Map comes out.",
    foot: "7 steps · 3 judgment calls · 4 guardrails",
  },
  {
    title: "Teach",
    text: "A new hire picks the agent. It sits next to their cursor, points at the field it means, and stops them where the expert would have stopped.",
    foot: "Cost center",
  },
] as const;

const ANSWERS = [
  { q: "When to ask", a: "At natural pauses: after a send, a save, a tab switch. Never while you type. At most one question every two minutes." },
  { q: "What to ask", a: "The why behind a decision you just made. Guardrails first: limits, exceptions, and when you stop and ask someone." },
  { q: "When it has understood", a: 'When it explains the process back in about 45 seconds and you say "yes, that is how it works". Every step needs a score of at least 75%.' },
  { q: "Whether the new hire learned", a: "Every step ends as Mastered or Practice next, based on what they actually did on their own screen." },
  { q: "Trust", a: 'Say "off the record" or press the button and capture stops. Names, emails and bank details are redacted before anything is stored.' },
] as const;

const ROWS = [
  ["4471", "Bürohaus Meier AG", "1,284.50", "4711 opex"],
  ["4502", "Novak Logistika s.r.o.", "3,960.00", "4711 opex"],
  ["4517", "Krämer Antriebstechnik", "7,200.00", "4711 → 0400"],
  ["4523", "Alpen Clean Services", "2,150.00", "·"],
] as const;

export function ctaFor(mode: string): { label: string; href: string } {
  return mode === "local" ? { label: "Open the app", href: "/capture" } : { label: "Sign in", href: "/login" };
}

const muted = { color: "var(--mu)" } as const;
const faint = { color: "var(--fa)" } as const;
const wrap = "mx-auto max-w-[1240px] px-4 sm:px-8";
const row = "grid grid-cols-[56px_minmax(0,1fr)_92px_128px] gap-3 px-[18px]";

const PIP = { shape: "blob", face: "curious", color: "#ECEAE5", accent: "#3A4EFD" };

function CostCenter({ value }: { value: string }) {
  if (value.includes("→")) {
    const [from, to] = value.split(" → ");
    return (
      <span className="flex items-center gap-1.5">
        <span className="ui-mono line-through" style={faint}>{from}</span>
        <span className="ui-mono rounded-[6px] border px-[7px] py-0.5" style={{ borderColor: "var(--ac)", color: "var(--ac2)" }}>{to}</span>
      </span>
    );
  }
  return <span className="ui-mono" style={value === "·" ? faint : muted}>{value}</span>;
}

export default function Landing({ mode }: { mode: string }) {
  const cta = ctaFor(mode);
  return (
    <div className="min-h-screen overflow-hidden" style={{ background: "var(--bg)" }} data-screen="landing">
      <header className={`${wrap} flex flex-wrap items-center justify-between gap-4 py-[22px]`}>
        <a href="#top" className="flex items-center gap-2.5 text-base font-semibold tracking-[-0.01em]" style={{ color: "var(--tx)" }}>
          <BrandMark />
          AI Apprentice
        </a>
        <nav className="flex flex-wrap items-center gap-1" aria-label="Main">
          <a className={buttonClass("ghost")} style={{ color: "var(--tx)" }} href="#how">How it works</a>
          <a className={buttonClass("ghost")} style={{ color: "var(--tx)" }} href="#test">The Apprentice Test</a>
          <a className={buttonClass("ghost")} style={{ color: "var(--tx)" }} href="#trust">Trust</a>
          <Link className={buttonClass("secondary")} href={cta.href}>{cta.label}</Link>
        </nav>
      </header>

      <section id="top" className={`${wrap} grid items-center gap-16 pt-14 pb-24 [grid-template-columns:repeat(auto-fit,minmax(min(100%,460px),1fr))]`}>
        <div className="flex min-w-0 flex-col gap-7">
          <Badge kind="accent" className="self-start">For teams whose experts are about to retire</Badge>
          <h1 className="ui-td">Keep the judgment when the expert retires.</h1>
          <p className="max-w-[32em] text-[19px] leading-[1.55]" style={muted}>
            Train an agent while you do your real work. It watches quietly, asks short spoken questions at natural pauses, and later teaches the next person on their own screen.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link className={buttonClass("primary", "lg")} href={cta.href}>{cta.label}</Link>
            <a className={buttonClass("secondary", "lg")} href="#how">See how it works</a>
          </div>
          <p className="text-[13px]" style={faint}>Runs next to Outlook, Excel, PowerPoint and any browser tab. Nothing to integrate.</p>
        </div>

        <div className="flex min-w-0 flex-col">
          <div className="ui-card overflow-hidden" style={{ boxShadow: "var(--sh)" }}>
            <div className="flex items-center gap-2 border-b border-[var(--ln)] px-4 py-3">
              {[0, 1, 2].map((i) => (
                <span key={i} className="size-2.5 rounded-full" style={{ background: "var(--s3)" }} />
              ))}
              <span className="ui-mono ml-2 text-xs" style={muted}>Invoice coding · October</span>
              <Badge kind="missing" className="ml-auto">Training · 03:15</Badge>
            </div>
            <div className="flex flex-col pt-1.5 pb-2.5">
              <div className={`${row} py-2 text-xs font-medium`} style={faint}>
                <span>Invoice</span><span>Supplier</span><span className="text-right">Amount €</span><span>Cost center</span>
              </div>
              {ROWS.map(([n, s, a, c]) => (
                <div key={n} className={`${row} border-t border-[var(--ln)] py-2.5 text-sm`} style={n === "4517" ? { background: "var(--acs)" } : undefined}>
                  <span className="ui-mono">{n}</span><span>{s}</span><span className="ui-mono text-right">{a}</span><CostCenter value={c} />
                </div>
              ))}
            </div>
          </div>
          <div className="relative -mt-9 flex items-end gap-3.5 pl-5">
            <AgentAvatar avatar={PIP} state="asking" size={104} className="flex-none" />
            <div className="flex min-w-0 flex-col gap-2 pb-1.5">
              <div className="ui-bub" style={{ boxShadow: "var(--sh)" }}>
                <div className="mb-0.5 text-xs" style={muted}>Pip · asked at a pause</div>
                <div className="text-[15px]">You moved that one to capex. What made you do that?</div>
              </div>
              <div className="ui-bub ui-bub-expert self-end text-xl leading-[1.2]">Equipment over €5,000 is always capex.</div>
            </div>
          </div>
          <div className="mt-3 flex justify-end">
            <Badge kind="limit">Guardrail learned · Limit · over €5,000 → capex 0400</Badge>
          </div>
        </div>
      </section>

      <section id="how" className="border-t border-[var(--ln)]">
        <div className={`${wrap} flex flex-col gap-10 py-[88px]`}>
          <div className="flex max-w-[640px] flex-col gap-3">
            <span className="ui-eb">How it works</span>
            <h2 className="ui-t1">Train, Map, Teach.</h2>
            <p className="text-base" style={muted}>One afternoon of real work becomes a map a new hire can follow, with the expert&apos;s reasons attached to every step.</p>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))]">
            {STEPS.map((s, i) => (
              <div key={s.title} className="ui-card flex flex-col gap-[18px] p-7">
                <div className="flex items-center gap-3">
                  <span className="ui-mono inline-flex size-[30px] items-center justify-center rounded-full border border-[var(--ln2)] text-[13px]">{i + 1}</span>
                  <h3 className="ui-t2">{s.title}</h3>
                </div>
                <p className="text-[15px]" style={muted}>{s.text}</p>
                <div className="mt-auto rounded-[12px] p-3.5 text-xs" style={{ background: "var(--s2)", ...muted }}>{s.foot}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="test" className="border-t border-[var(--ln)]">
        <div className={`${wrap} flex flex-wrap gap-12 py-[88px]`}>
          <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-3">
            <span className="ui-eb">The Apprentice Test</span>
            <h2 className="ui-t1">Five questions any good apprentice has to answer.</h2>
            <p className="text-base" style={muted}>How we decided when the agent talks, what it learns, and when it is ready to teach.</p>
          </div>
          <div className="flex min-w-0 flex-[2_1_560px] flex-col">
            {ANSWERS.map((x, i) => (
              <div key={x.q} className="grid grid-cols-[32px_minmax(0,200px)_minmax(0,1fr)] items-baseline gap-5 border-t border-[var(--ln)] py-[22px] last:border-b">
                <span className="ui-mono" style={faint}>{i + 1}</span>
                <h3 className="ui-t3">{x.q}</h3>
                <p className="text-[15px]" style={muted}>{x.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className={`${wrap} pb-24`}>
        <div className="ui-card flex flex-wrap items-center justify-between gap-8 p-10">
          <div className="flex min-w-0 flex-[1_1_520px] flex-col gap-2">
            <h2 className="ui-t2">Off the record, whenever you say it.</h2>
            <p className="max-w-[46em] text-[15px]" style={muted}>
              Capture stops the moment you say &quot;off the record&quot;. Personal data is redacted before storage. Nobody learns from a step until the expert has confirmed it.
            </p>
          </div>
          <Link className={buttonClass("primary", "lg")} href={cta.href}>{cta.label}</Link>
        </div>
      </section>

      <footer className="border-t border-[var(--ln)]">
        <div className={`${wrap} flex flex-wrap justify-between gap-4 py-6 text-sm`} style={faint}>
          <span>AI Apprentice · hackathon build, October 2026</span>
          <span>Built in Zug, Switzerland</span>
        </div>
      </footer>
    </div>
  );
}
