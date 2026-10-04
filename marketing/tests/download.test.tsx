import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DownloadList from "@/components/landing/DownloadList";
import { DESKTOP_RELEASE, INSTALL_STEPS } from "@/lib/downloads";
import { ctaFor, downloads } from "@/lib/site";

const ARM = "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0-arm64.dmg";
const X64 = "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0.dmg";
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("download page logic", () => {
  it("lists macOS Apple silicon, macOS Intel and Windows in that order", () => {
    expect(downloads().map((d) => d.id)).toEqual(["mac-arm64", "mac-x64", "win"]);
  });

  it("the macOS builds link to the GitHub release; Windows has no link", () => {
    expect(downloads().map((d) => d.href)).toEqual([ARM, X64, null]);
    expect(DESKTOP_RELEASE.version).toBe("0.1.0");
  });

  it("Apple silicon is the primary button, Intel secondary, Windows 'Coming soon' without a link", () => {
    const html = renderToStaticMarkup(<DownloadList items={downloads()} version="0.1.0" />);
    expect(html).toMatch(new RegExp(`class="ui-btn ui-bp ui-bl" href="${esc(ARM)}">Download for macOS \\(Apple silicon\\)<`));
    expect(html).toMatch(new RegExp(`class="ui-btn ui-bs ui-bl" href="${esc(X64)}">Download for macOS \\(Intel\\)<`));
    expect(html).toContain("Version 0.1.0 · 145 MB");
    expect(html).toContain("Version 0.1.0 · 153 MB");
    expect(html.match(/<a /g)).toHaveLength(2);
    const win = html.slice(html.indexOf('data-download="win"'));
    expect(win).toContain("Coming soon");
    expect(win).not.toContain("<a ");
    expect(html).not.toContain("Download for Windows");
  });

  it("the page renders all three builds, the release link, the which-build hint, the notarized note and the simplified install steps", async () => {
    const { default: DownloadPage } = await import("@/app/download/page");
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain('data-screen="download"');
    for (const id of ["mac-arm64", "mac-x64", "win"]) expect(html).toContain(`data-download="${id}"`);
    expect(html).toContain(`href="${ARM}"`);
    expect(html).toContain(`href="${X64}"`);
    expect(html).toContain(`href="${DESKTOP_RELEASE.page}"`);
    expect(html).toContain("data-install-steps");
    const steps = html.slice(html.indexOf("data-install-steps"));
    const order = [
      "Open the .dmg and drag AI Apprentice to Applications.",
      "Open it. macOS asks once whether to open an app downloaded from the internet: click Open.",
      "Sign in.",
      "Grant Screen Recording, Microphone and Accessibility, then restart the app once.",
      "Still blocked? System Settings &gt; Privacy &amp; Security &gt; Open Anyway.",
    ];
    let at = -1;
    for (const s of order) {
      const i = steps.indexOf(s, at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    expect(html).not.toContain("xattr");
    expect(html).not.toContain("<code");
    expect(html).not.toContain("not notarized");
    expect(html.match(/Open Anyway/g)).toHaveLength(1);
    expect(html).toContain('data-notarized="">Signed and notarized by Apple</span>');
    expect(html).toContain("Which build: Apple menu &gt; About This Mac: Chip = Apple M… -&gt; Apple Silicon; Processor = Intel -&gt; Intel");
    expect(html.match(/<li>/g)).toHaveLength(INSTALL_STEPS.length);
    expect(html).not.toContain("Download for Windows");
  });

  it("CTA targets: sign in on the app's /login, open the app at its URL", () => {
    expect(ctaFor("https://app.example.com/")).toEqual({ signIn: "https://app.example.com/login", open: { label: "Open the app", href: "https://app.example.com/" } });
    expect(ctaFor(null).signIn).toBeNull();
  });
});
