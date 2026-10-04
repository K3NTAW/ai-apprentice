import type { Metadata } from "next";
import DownloadList from "@/components/landing/DownloadList";
import SitePage from "@/components/landing/SitePage";
import { appUrl, downloadEnv, downloads } from "@/lib/site";

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
          The desktop app is in private beta. The web app runs in the browser today
          {app ? (
            <>
              : <a className="underline" href={app}>open the web app</a>.
            </>
          ) : (
            "."
          )}
        </p>
      </div>
      <DownloadList items={downloads(downloadEnv())} />
    </SitePage>
  );
}
