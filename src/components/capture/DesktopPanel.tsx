// Companion slot in the Capture and Teach consoles (one-app D2):
// - desktop app (bridge): a small 'Running in AI Apprentice' status with the permission state, no pairing card;
// - plain browser (none): 'Get the desktop app' with the download links from the build env (hidden when unset);
// - websocket opt-in: the old pairing card; detecting (SSR, first render): nothing, so the app never flashes the panel.
import type { TransportHost } from "@/lib/companion/transport";
import CompanionCard, { missingPermissions, type CompanionCardProps } from "./CompanionCard";

export type DesktopDownloads = { mac: string | null; win: string | null };

const httpsOnly = (v: string | undefined) => (v && /^https:\/\//.test(v.trim()) ? v.trim() : null);

/** NEXT_PUBLIC_* are inlined at build time, so they are read by their literal names. */
export function desktopDownloads(
  env: { mac?: string; win?: string } = {
    mac: process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_MAC,
    win: process.env.NEXT_PUBLIC_DESKTOP_DOWNLOAD_WIN,
  },
): DesktopDownloads {
  return { mac: httpsOnly(env.mac), win: httpsOnly(env.win) };
}

/** Green only once the app answered with a status event; no event within 3 s reads 'App not responding'. */
export function appStatusLabel(status: CompanionCardProps["status"]): string {
  if (status === "paired") return "Running in AI Apprentice";
  if (status === "not responding") return "App not responding";
  if (status === "connecting") return "Connecting to AI Apprentice...";
  return "AI Apprentice not connected";
}

const PERMISSION_ROWS: [keyof NonNullable<CompanionCardProps["permissions"]>, string, string?][] = [
  ["screen", "Screen Recording"],
  ["accessibility", "Accessibility", "Without it the agent cannot tell which field you typed in"],
  ["input", "Input Monitoring", "Without it shortcuts and typing pauses are not seen"],
];

/** macOS privacy panes behind each Fix button (opened by the system; harmless elsewhere). */
const SETTINGS_PANE: Record<string, string> = {
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
};

/** Desktop app card (Capture.dc.html 'Companion' card without the pairing digits): status and the permission rows. */
export function AppStatus({ companion }: { companion: CompanionCardProps }) {
  const missing = missingPermissions(companion.permissions);
  const running = companion.status === "paired";
  return (
    <section data-testid="app-status" className="ui-card flex flex-col" style={{ padding: 22, gap: 14 }}>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <h2 className="ui-t3">Desktop app</h2>
        <span className={`ui-bdg ${running ? "ui-k-ok" : "ui-k-pend"}`}>{running ? "Running" : "Not connected"}</span>
      </div>
      <span className="text-[13px]" style={{ color: "var(--mu)" }}>
        {appStatusLabel(companion.status)}
        {companion.permissions && missing.length === 0 && " · All permissions granted"}
      </span>
      {companion.permissions && (
        <div className="flex flex-col" style={{ borderTop: "1px solid var(--ln)" }}>
          {PERMISSION_ROWS.map(([key, name, why], i) => {
            const ok = companion.permissions![key];
            return (
              <div
                key={key}
                data-testid={`permission-${key}`}
                className="flex flex-wrap items-center justify-between"
                style={{ gap: 10, padding: "10px 0", borderTop: i ? "1px solid var(--ln)" : undefined }}
              >
                <span className="text-[13px]">
                  {name}
                  {!ok && why && (
                    <span className="block text-xs" style={{ color: "var(--fa)" }}>
                      {why}
                    </span>
                  )}
                </span>
                {ok ? (
                  <span className="ui-bdg ui-k-ok">Allowed</span>
                ) : (
                  <span className="flex items-center" style={{ gap: 8 }}>
                    <span className="ui-bdg ui-k-rd">Missing</span>
                    <a href={SETTINGS_PANE[key]} className="ui-btn ui-bs ui-bsm">
                      Fix
                    </a>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {missing.length > 0 && (
        <p role="alert" className="text-xs" style={{ color: "var(--am)" }}>
          Missing permissions: {missing.join(", ")}. Grant them in your system settings, then restart the app.
        </p>
      )}
    </section>
  );
}

export function GetDesktopApp({ downloads = desktopDownloads() }: { downloads?: DesktopDownloads }) {
  return (
    <section id="companion" data-testid="get-desktop-app" className="ui-card flex flex-col" style={{ padding: 22, gap: 14 }}>
      <div className="flex items-center justify-between" style={{ gap: 10 }}>
        <h2 className="ui-t3">Get the desktop app</h2>
        <span className="ui-bdg ui-k-pend">Browser</span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--mu)" }}>
        Training and teaching run in the AI Apprentice desktop app: it sees your real apps, docks the agent at the side of
        the screen and shares the screen without a picker. Agents, Work Maps and your workspace work here in the browser.
      </p>
      {(downloads.mac || downloads.win) && (
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          {downloads.mac && (
            <a href={downloads.mac} rel="noreferrer" className="ui-btn ui-bs ui-bsm">
              Download for macOS
            </a>
          )}
          {downloads.win && (
            <a href={downloads.win} rel="noreferrer" className="ui-btn ui-bs ui-bsm">
              Download for Windows
            </a>
          )}
        </div>
      )}
    </section>
  );
}

export default function CompanionSlot({
  host,
  companion,
  downloads,
}: {
  host: TransportHost;
  companion: CompanionCardProps;
  downloads?: DesktopDownloads;
}) {
  if (host === "detecting") return null;
  if (host === "bridge") return <AppStatus companion={companion} />;
  if (host === "none") return <GetDesktopApp downloads={downloads} />;
  return (
    <div id="companion">
      <CompanionCard {...companion} />
    </div>
  );
}
