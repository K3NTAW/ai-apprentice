"use client";

// User card status line (Sidebar.dc.html): 'desktop app connected' inside the desktop app, 'browser' otherwise.
// Server render and hydration read 'browser'; detection runs on the client (window.apprentice).
import { useInDesktopApp } from "./AppOnly";

export const viewerStatus = (inApp: boolean) => (inApp ? "desktop app connected" : "browser");

export default function ViewerStatus({ inApp }: { inApp?: boolean }) {
  const detected = useInDesktopApp();
  const app = inApp ?? detected;
  return (
    <span className="flex items-center gap-[6px] text-xs leading-[1.3]" style={{ color: "var(--fa)" }} data-testid="viewer-status">
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: app ? "var(--gr)" : "var(--fa)" }} />
      {viewerStatus(app)}
    </span>
  );
}
