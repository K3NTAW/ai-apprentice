"use client";
// Step 2 Desktop permissions. In the desktop app: live rows from the bridge 'status' events, 'Grant' opens the System
// Settings pane (window.apprentice.openPermissionSettings), 'Restart app' when the app accepts window('relaunch').
// In the browser: 'Get the desktop app' with the download links (DesktopPanel GetDesktopApp).
import { useEffect, useState, useSyncExternalStore } from "react";
import { GetDesktopApp } from "@/components/capture/DesktopPanel";
import { Badge, buttonClass } from "@/components/ui";
import {
  canRelaunch,
  desktopBridge,
  grantPermission,
  permissionRows,
  relaunchApp,
  RESTART_NOTE,
  type DesktopBridge,
  type PermissionKind,
  type PermissionRow,
} from "@/lib/onboarding/permissions";

const muted = { color: "var(--mu)" } as const;
const noSubscribe = () => () => {};

export function PermissionsView({
  rows,
  relaunch,
  onGrant,
  onRelaunch,
}: {
  rows: PermissionRow[];
  relaunch: boolean;
  onGrant: (kind: PermissionKind) => void;
  onRelaunch: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="permissions-app">
      <ul className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.kind} data-permission={r.kind} data-value={r.value} className="flex items-center gap-3 rounded-[12px] p-3" style={{ background: "var(--s2)" }}>
            <span
              aria-hidden="true"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-[13px]"
              style={r.value === "granted" ? { background: "var(--grs)", color: "var(--gr)" } : { border: "1px solid var(--ln2)", color: "var(--fa)" }}
            >
              {r.value === "granted" ? "✓" : r.value === "unknown" ? "?" : ""}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm" style={{ fontWeight: 600 }}>{r.label}</span>
              <span className="text-xs" style={muted}>{r.why}</span>
            </span>
            {r.value === "granted" ? (
              <Badge kind="confirmed">Granted</Badge>
            ) : (
              <>
                {r.value === "unknown" && <span className="text-xs" style={muted}>Unknown</span>}
                <button type="button" className={buttonClass("secondary", "sm")} onClick={() => onGrant(r.kind)}>
                  Grant
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs" style={{ color: "var(--fa)" }}>{RESTART_NOTE}</p>
      {relaunch && (
        <div>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={onRelaunch}>
            Restart app
          </button>
        </div>
      )}
    </div>
  );
}

export default function PermissionsStep({ bridge: injected }: { bridge?: DesktopBridge | null }) {
  // undefined on the server: it cannot know whether this is the desktop app. window.apprentice never changes.
  const detected = useSyncExternalStore(noSubscribe, () => desktopBridge(), () => undefined);
  const bridge = injected !== undefined ? injected : detected;
  const [status, setStatus] = useState<unknown>(null);
  useEffect(() => (bridge ? bridge.on("status", setStatus) : undefined), [bridge]);

  if (bridge === undefined) return <p style={muted}>Checking for the desktop app…</p>;
  if (!bridge)
    return (
      <div className="flex flex-col gap-3" data-testid="permissions-browser">
        <p style={muted}>Training runs in the desktop app. Get it now, or skip this step and set it up later.</p>
        <GetDesktopApp />
      </div>
    );
  return (
    <PermissionsView
      rows={permissionRows(status)}
      relaunch={canRelaunch(bridge)}
      onGrant={(kind) => void grantPermission(bridge, kind)}
      onRelaunch={() => relaunchApp(bridge)}
    />
  );
}
