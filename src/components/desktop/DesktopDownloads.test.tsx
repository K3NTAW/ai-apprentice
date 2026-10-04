import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellHeader from "@/components/shell/ShellHeader";
import { DESKTOP_RELEASE, DOWNLOAD_HREF } from "@/lib/downloads";
import DesktopDownloads from "./DesktopDownloads";

const ARM = "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0-arm64.dmg";
const X64 = "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0.dmg";

describe("Get the desktop app", () => {
  it("links the macOS builds to the GitHub release, the same URLs as the marketing site", () => {
    expect([DESKTOP_RELEASE.macArm64.href, DESKTOP_RELEASE.macX64.href]).toEqual([ARM, X64]);
    const html = renderToStaticMarkup(<DesktopDownloads />);
    expect(html).toContain(`href="${ARM}" rel="noreferrer" class="ui-btn ui-bp ui-bsm mt-auto self-start"><svg class="ui-ic"`);
    expect(html).toContain(`href="${X64}" rel="noreferrer" class="ui-btn ui-bs ui-bsm mt-auto self-start"><svg class="ui-ic"`);
    expect(html).toContain("</svg>Download for macOS (Apple silicon)<");
    expect(html).toContain("</svg>Download for macOS (Intel)<");
    expect(html).toContain("Version 0.1.0 · 145 MB");
    expect(html).toContain("Version 0.1.0 · 153 MB");
    expect(html).toContain(`href="${DESKTOP_RELEASE.page}"`);
  });

  it("download buttons are compact: small size, not stretched to the card width", () => {
    const html = renderToStaticMarkup(<DesktopDownloads />);
    const btns = html.match(/<a [^>]*class="ui-btn[^"]*"/g) ?? [];
    expect(btns).toHaveLength(2);
    for (const b of btns) {
      expect(b).toContain("ui-bsm");
      expect(b).toContain("self-start");
      expect(b).not.toMatch(/w-full|self-stretch/);
    }
  });

  it("Windows reads 'Coming soon' without a link", () => {
    const html = renderToStaticMarkup(<DesktopDownloads />);
    const win = html.slice(html.indexOf('data-download="win"'), html.indexOf("data-install-steps"));
    expect(win).toContain("Coming soon");
    expect(win).not.toContain("<a ");
    expect(html).not.toContain("Download for Windows");
  });

  it("shows the simplified install steps in order, the one-line fallback, the notarized note and the which-build hint", () => {
    const html = renderToStaticMarkup(<DesktopDownloads />);
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
  });

  it("the sidebar 'Get the desktop app' opens this page", () => {
    const html = renderToStaticMarkup(<ShellHeader user={null} />);
    expect(DOWNLOAD_HREF).toBe("/download");
    expect(html).toMatch(/href="\/download"[^>]*>.*?Get the desktop app<\/span><\/a>/);
  });
});
