// The app's 'Get the desktop app' page body: the macOS builds from the GitHub release (src/lib/downloads.ts),
// Windows 'Coming soon' without a link, a which-build hint and the first-launch steps for the non-notarized build.
// Download buttons are small and self-start so the flex-col card does not stretch them to its width.
import { DESKTOP_RELEASE, INSTALL_STEPS, WHICH_BUILD } from "@/lib/downloads";

const BUILDS = [
  { id: "mac-arm64", label: "Apple silicon", detail: "M1 and later · Recommended", build: DESKTOP_RELEASE.macArm64, cls: "ui-bp" },
  { id: "mac-x64", label: "Intel", detail: "Intel Macs", build: DESKTOP_RELEASE.macX64, cls: "ui-bs" },
] as const;

export default function DesktopDownloads() {
  return (
    <main className="flex max-w-[760px] flex-col p-8" style={{ gap: 18 }} data-testid="desktop-downloads">
      <div className="flex flex-col" style={{ gap: 8 }}>
        <span className="ui-eb">Download</span>
        <h1 className="ui-t1">Get the desktop app</h1>
        <p className="text-[14px]" style={{ color: "var(--mu)" }}>
          Training and teaching run in the AI Apprentice desktop app: it sees your real apps, docks the agent at the side of
          the screen and shares the screen without a picker. Version {DESKTOP_RELEASE.version},{" "}
          <a className="underline" href={DESKTOP_RELEASE.page} rel="noreferrer">release notes</a>.
        </p>
        <p className="text-[13px]" style={{ color: "var(--mu)" }} data-which-build="">
          Which build: {WHICH_BUILD}
        </p>
      </div>
      <div className="grid [grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr))]" style={{ gap: 12 }}>
        {BUILDS.map((b) => (
          <section key={b.id} className="ui-card flex flex-col" style={{ padding: 22, gap: 12 }} data-download={b.id}>
            <div className="flex flex-col" style={{ gap: 4 }}>
              <span className="ui-eb">macOS</span>
              <h2 className="ui-t3">{b.label}</h2>
              <p className="text-[13px]" style={{ color: "var(--mu)" }}>{b.detail}</p>
              <p className="text-[12px]" style={{ color: "var(--fa)" }}>
                Version {DESKTOP_RELEASE.version} · {b.build.size}
              </p>
            </div>
            <a href={b.build.href} rel="noreferrer" className={`ui-btn ${b.cls} ui-bsm mt-auto self-start`}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14" />
              </svg>
              Download for macOS ({b.label})
            </a>
          </section>
        ))}
        <section className="ui-card flex flex-col" style={{ padding: 22, gap: 12 }} data-download="win">
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span className="ui-eb">Windows</span>
            <h2 className="ui-t3">Windows</h2>
            <p className="text-[13px]" style={{ color: "var(--mu)" }}>Windows 10 and 11, 64-bit</p>
          </div>
          <span className="ui-bdg ui-k-pend mt-auto self-start">Coming soon</span>
        </section>
      </div>
      <section className="ui-card flex flex-col" style={{ padding: 22, gap: 10 }} data-install-steps="">
        <h2 className="ui-t3">Install</h2>
        <p className="text-[13px]" style={{ color: "var(--mu)" }}>The build is not notarized by Apple yet, so macOS asks once before the first launch.</p>
        <ol className="flex list-decimal flex-col pl-5 text-[13px]" style={{ gap: 6 }}>
          {INSTALL_STEPS.map((s) => (
            <li key={s.text}>
              {s.text}
              {s.code && (
                <code className="mt-1 block select-all rounded px-2 py-1 font-mono text-[12px]" style={{ background: "var(--s2)" }}>
                  {s.code}
                </code>
              )}
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
