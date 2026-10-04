import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import DownloadList from "@/components/landing/DownloadList";
import { ctaFor, downloadEnv, downloads } from "@/lib/site";

afterEach(() => vi.unstubAllEnvs());

describe("download page logic", () => {
  it("lists macOS Apple silicon, macOS Intel and Windows in that order", () => {
    expect(downloads({}).map((d) => d.id)).toEqual(["mac-arm64", "mac-x64", "win"]);
  });

  it("each build is 'Coming soon' without a link when its env var is unset, empty or not a URL", () => {
    for (const env of [{}, { macArm64: "", macX64: "  ", win: "javascript:alert(1)" }]) {
      expect(downloads(env).every((d) => d.href === null)).toBe(true);
      const html = renderToStaticMarkup(<DownloadList items={downloads(env)} />);
      expect(html.match(/Coming soon/g)).toHaveLength(3);
      expect(html).not.toContain("<a ");
    }
  });

  it("a set link shows its button; the others stay 'Coming soon'", () => {
    const items = downloads({ macArm64: "https://dl.example.com/AI-Apprentice-arm64.dmg" });
    const html = renderToStaticMarkup(<DownloadList items={items} />);
    expect(html).toMatch(/href="https:\/\/dl\.example\.com\/AI-Apprentice-arm64\.dmg"[^>]*>Download for macOS \(Apple silicon\)</);
    expect(html.match(/Coming soon/g)).toHaveLength(2);
  });

  it("reads NEXT_PUBLIC_DOWNLOAD_MAC_ARM64 / _MAC_X64 / _WIN", () => {
    vi.stubEnv("NEXT_PUBLIC_DOWNLOAD_MAC_ARM64", "https://dl.example.com/a.dmg");
    vi.stubEnv("NEXT_PUBLIC_DOWNLOAD_MAC_X64", "https://dl.example.com/x.dmg");
    vi.stubEnv("NEXT_PUBLIC_DOWNLOAD_WIN", "https://dl.example.com/w.exe");
    expect(downloads(downloadEnv()).map((d) => d.href)).toEqual(["https://dl.example.com/a.dmg", "https://dl.example.com/x.dmg", "https://dl.example.com/w.exe"]);
  });

  it("the page renders all three builds", async () => {
    const { default: DownloadPage } = await import("@/app/download/page");
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain('data-screen="download"');
    for (const id of ["mac-arm64", "mac-x64", "win"]) expect(html).toContain(`data-download="${id}"`);
  });

  it("CTA targets: sign in on the app's /login, open the app at its URL", () => {
    expect(ctaFor("https://app.example.com/")).toEqual({ signIn: "https://app.example.com/login", open: { label: "Open the app", href: "https://app.example.com/" } });
    expect(ctaFor(null).signIn).toBeNull();
  });
});
