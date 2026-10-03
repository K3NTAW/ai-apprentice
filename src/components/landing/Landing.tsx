// Public product landing page. The CTA depends on the mode: 'Sign in' with Supabase, 'Open the app' in local mode.
import Link from "next/link";

export const STEPS = [
  { title: "Capture", text: "The expert does real work while a quiet voice asks why, only at natural pauses." },
  { title: "Map", text: "Steps, reasons and guardrails become a Work Map the expert checks and confirms." },
  { title: "Teach", text: "The new hire works real cases while a tutor stops them where the expert would have stopped." },
] as const;

const ANSWERS = [
  { q: "When to ask", a: "It waits for real pauses and stays quiet while the expert types, reads or talks." },
  { q: "What to ask", a: "Only what the screen cannot explain: the reason, the limit, the exception." },
  { q: "When it has understood", a: "The debrief ends when every step has a reason, and the expert's teach-back confirms it." },
  { q: "Whether the new hire learned", a: "They handle a new case alone, and the mastery summary shows what still needs practice." },
  { q: "Trust", a: "The expert can go off the record at any time, and personal data on screen is redacted." },
] as const;

export function ctaFor(mode: string): { label: string; href: string } {
  return mode === "local" ? { label: "Open the app", href: "/capture" } : { label: "Sign in", href: "/login" };
}

export default function Landing({ mode }: { mode: string }) {
  const cta = ctaFor(mode);
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 py-10 sm:px-8 sm:py-16">
      <section className="flex flex-col gap-4">
        <p className="text-sm font-semibold text-slate-500">AI Apprentice</p>
        <h1 className="text-2xl font-semibold sm:text-4xl">
          Your best expert&apos;s judgment, captured while they work and taught to the next hire
        </h1>
        <Link href={cta.href} className="self-start rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700">
          {cta.label}
        </Link>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded border border-slate-200 p-4">
            <h2 className="font-semibold">
              {i + 1}. {s.title}
            </h2>
            <p className="mt-1 text-sm text-slate-600">{s.text}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">The Apprentice Test</h2>
        <dl className="flex flex-col gap-2 text-sm">
          {ANSWERS.map((x) => (
            <div key={x.q} className="sm:flex sm:gap-2">
              <dt className="font-medium sm:w-56 sm:shrink-0">{x.q}</dt>
              <dd className="text-slate-600">{x.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-xs text-slate-500">Off the record on request, PII redaction on every frame, private workspaces per company.</p>
    </main>
  );
}
