import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ApprenticeBridge } from "@/lib/companion/transport";
import { AppStatus, fixPermission, MANUAL_STEPS, PermissionFix } from "./DesktopPanel";

const app = (withAction = true) => {
  const openPermissionSettings = vi.fn(async () => ({ ok: true }));
  const b = { version: "1", platform: "darwin", on: () => () => {}, send: () => {}, window: () => {}, ...(withAction ? { openPermissionSettings } : {}) } as ApprenticeBridge;
  return { b, openPermissionSettings };
};

describe("permission Fix buttons", () => {
  it("in the app call window.apprentice.openPermissionSettings(kind)", () => {
    for (const [row, kind] of [
      ["screen", "screen"],
      ["accessibility", "accessibility"],
      ["input", "input-monitoring"],
      ["microphone", "microphone"],
    ]) {
      const { b, openPermissionSettings } = app();
      expect(fixPermission(row, b)).toBe(true);
      expect(openPermissionSettings).toHaveBeenCalledWith(kind);
    }
    const g = globalThis as { window?: unknown };
    const { b, openPermissionSettings } = app();
    g.window = { apprentice: b };
    try {
      expect(fixPermission("screen")).toBe(true);
      expect(openPermissionSettings).toHaveBeenCalledWith("screen");
      expect(renderToStaticMarkup(<PermissionFix permission="screen" />)).toMatch(/<button[^>]*>Fix<\/button>/);
    } finally {
      delete g.window;
    }
  });

  it("in the browser (or an app without the action) show the manual steps", () => {
    expect(fixPermission("screen", null)).toBe(false);
    expect(fixPermission("screen", app(false).b)).toBe(false);
    const html = renderToStaticMarkup(<PermissionFix permission="input" bridge={null} />);
    expect(html).toContain(MANUAL_STEPS["input-monitoring"].replace(/&/g, "&amp;"));
    expect(html).toMatch(/<summary[^>]*>Fix<\/summary>/);
    expect(html).not.toContain("<button");
  });

  it("never links or navigates to an x-apple or ms-settings URL", () => {
    const html = renderToStaticMarkup(
      <AppStatus companion={{ status: "paired", permissions: { screen: false, accessibility: false, input: false } } as never} />,
    );
    expect(html).not.toMatch(/x-apple|ms-settings/);
    expect(readFileSync(join(process.cwd(), "src/components/capture/DesktopPanel.tsx"), "utf8")).not.toMatch(/x-apple|ms-settings|location\s*=/);
  });
});
