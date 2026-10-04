import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Landing from "@/components/landing/Landing";

const render = (appUrl: string | null) => renderToStaticMarkup(<Landing appUrl={appUrl} />);

describe("landing (Main.dc.html, LandingLight, LandingPhone)", () => {
  it("renders the promise, the three steps, the Apprentice Test and trust", () => {
    const html = render("https://app.example.com");
    expect(html).toContain('data-screen="landing"');
    expect(html).toContain("Keep the judgment when the expert retires.");
    expect(html).toContain("For teams whose experts are about to retire");
    expect(html).toContain("Train, Map, Teach.");
    for (const step of ["Train", "Map", "Teach"]) expect(html).toContain(`>${step}</h3>`);
    expect(html).toContain("Five questions any good apprentice has to answer.");
    for (const q of ["When to ask", "What to ask", "When it has understood", "Whether the new hire learned", "Trust"]) expect(html).toContain(`>${q}</h3>`);
    expect(html).toContain("Off the record, whenever you say it.");
    expect(html).toContain("Built in Zug, Switzerland");
    expect(html).toContain("Runs next to Outlook, Excel, PowerPoint and any browser tab. Nothing to integrate.");
    expect(html).not.toMatch(/\bERP\b|sandbox/i);
  });

  it("claims only what the product does: text redaction, frames not yet, questions at most one a minute", () => {
    const html = render(null);
    expect(html).toContain("Text (transcripts, answers, events) is redacted before storage; screen frames are not redacted yet, frame redaction is next.");
    expect(html).toContain("At most one question a minute by default, adjustable per agent.");
    expect(html).not.toMatch(/two minutes|Personal data is redacted|redacted before anything is stored/);
  });

  it("the privacy page says text is redacted and frames are not yet", async () => {
    const { default: PrivacyPage } = await import("@/app/privacy/page");
    const html = renderToStaticMarkup(<PrivacyPage />);
    expect(html).toContain("text (transcripts, answers, events) is redacted before storage");
    expect(html).toContain("screen frames are not redacted yet");
  });

  it("'Sign in' and 'Open the app' point to NEXT_PUBLIC_APP_URL", () => {
    const html = render("https://app.example.com/");
    expect(html).toMatch(/href="https:\/\/app\.example\.com\/login"[^>]*>Sign in</);
    expect(html).toMatch(/href="https:\/\/app\.example\.com\/"[^>]*>Open the app</);
    expect(html).not.toMatch(/href="\/(login|capture|agents)"/);
  });

  it("without NEXT_PUBLIC_APP_URL there is no 'Sign in' and the CTA is the download page", () => {
    const html = render(null);
    expect(html).not.toContain("Sign in");
    expect(html).not.toContain("Open the app");
    expect(html).toMatch(/href="\/download"[^>]*>Download</);
  });

  it("links the download, privacy and imprint pages, and the phone menu", () => {
    const html = render("https://app.example.com");
    for (const p of ["/download", "/privacy", "/imprint"]) expect(html).toContain(`href="${p}"`);
    expect(html).toContain('aria-label="Menu"');
  });

  it("shares the app's design tokens by copy, never by import from ../src", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const t of ["--bg: #050505;", "--ac: #4280FF;", "--avatar-pip-body: #ECEAE5;"]) expect(css).toContain(t);
    expect(css).toMatch(/data-theme="light"|prefers-color-scheme: light/);
    for (const f of ["components/landing/Landing.tsx", "app/layout.tsx", "components/ui/index.tsx"]) expect(readFileSync(f, "utf8")).not.toMatch(/from "(\.\.\/)+src\//);
  });
});
