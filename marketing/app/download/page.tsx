import type { Metadata } from "next";
import DownloadList from "@/components/landing/DownloadList";
import SitePage from "@/components/landing/SitePage";
import { DESKTOP_RELEASE, INSTALL_STEPS } from "@/lib/downloads";
import { appUrl, downloads } from "@/lib/site";

export const metadata: Metadata = { title: "Download · AI Apprentice" };

export default function DownloadPage() {
  const app = appUrl();
  return (
    <SitePage appUrl={app} screen="download">
      <div className="flex max-w-[640px] flex-col gap-3">
        <span className="ui-eb">Download</span>
        <h1 className="ui-t1">The desktop app</h1>
        <p className="text-base" style={{ color: "var(--mu)" }}>
          It sits next to the apps you already use, opens straight into your agents and asks its questions at natural pauses.
        </p>
        <p className="text-base" data-download-status="">
          Version {DESKTOP_RELEASE.version} for macOS, a private beta build.{" "}
          <a className="underline" href={DESKTOP_RELEASE.page}>Release notes</a>
          {app ? (
            <>
              . The web app runs in the browser: <a className="underline" href={app}>open the web app</a>.
            </>
          ) : (
            "."
          )}
        </p>
      </div>
      <DownloadList items={downloads()} version={DESKTOP_RELEASE.version} />
      <div className="ui-card flex max-w-[640px] flex-col gap-3 p-7" data-install-steps="">
        <h2 className="ui-t2">Install</h2>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          The build is not signed by Apple yet, so macOS asks once before the first launch.
        </p>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-[15px]">
          {INSTALL_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </div>
    </SitePage>
  );
}
