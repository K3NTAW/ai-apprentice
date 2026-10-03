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

export function AppStatus({ companion }: { companion: CompanionCardProps }) {
  const missing = missingPermissions(companion.permissions);
  return (
    <section data-testid="app-status" className="flex flex-col gap-1 rounded border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${companion.status === "paired" ? "bg-green-500" : "bg-slate-300"}`} />
        <span className="font-semibold">Running in AI Apprentice</span>
        {companion.permissions && missing.length === 0 && <span className="ml-auto text-slate-600">All permissions granted</span>}
      </div>
      {missing.length > 0 && (
        <p role="alert" className="text-amber-800">
          Missing permissions: {missing.join(", ")}. Grant them in your system settings, then restart the app.
        </p>
      )}
    </section>
  );
}

export function GetDesktopApp({ downloads = desktopDownloads() }: { downloads?: DesktopDownloads }) {
  return (
    <section id="companion" data-testid="get-desktop-app" className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3 text-xs">
      <h3 className="font-semibold">Get the desktop app</h3>
      <p className="text-slate-600">
        Training and teaching run in the AI Apprentice desktop app: it sees your real apps, docks the agent at the side of
        the screen and shares the screen without a picker. Agents, Work Maps and your workspace work here in the browser.
      </p>
      {(downloads.mac || downloads.win) && (
        <div className="flex gap-3">
          {downloads.mac && (
            <a href={downloads.mac} rel="noreferrer" className="text-blue-700 underline">
              Download for macOS
            </a>
          )}
          {downloads.win && (
            <a href={downloads.win} rel="noreferrer" className="text-blue-700 underline">
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
