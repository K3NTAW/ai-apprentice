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
    expect(html).toContain("Version 0.1.0 · 130 MB");
    expect(html).toContain("Version 0.1.0 · 134 MB");
    expect(html.match(/<a /g)).toHaveLength(2);
    const win = html.slice(html.indexOf('data-download="win"'));
    expect(win).toContain("Coming soon");
    expect(win).not.toContain("<a ");
    expect(html).not.toContain("Download for Windows");
  });

  it("the page renders all three builds, the release link and the unsigned-app install steps", async () => {
    const { default: DownloadPage } = await import("@/app/download/page");
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain('data-screen="download"');
    for (const id of ["mac-arm64", "mac-x64", "win"]) expect(html).toContain(`data-download="${id}"`);
    expect(html).toContain(`href="${ARM}"`);
    expect(html).toContain(`href="${X64}"`);
    expect(html).toContain(`href="${DESKTOP_RELEASE.page}"`);
    expect(html).toContain("data-install-steps");
    for (const s of ["drag AI Apprentice to Applications", "right-click AI Apprentice in Applications and choose Open", "Privacy &amp; Security and click Open Anyway", "Sign in.", "Grant Screen Recording, Microphone and Accessibility, then restart the app once."]) {
      expect(html).toContain(s);
    }
    expect(html.match(/<li>/g)).toHaveLength(INSTALL_STEPS.length);
    expect(html).not.toContain("Download for Windows");
  });

  it("CTA targets: sign in on the app's /login, open the app at its URL", () => {
    expect(ctaFor("https://app.example.com/")).toEqual({ signIn: "https://app.example.com/login", open: { label: "Open the app", href: "https://app.example.com/" } });
    expect(ctaFor(null).signIn).toBeNull();
  });
});
