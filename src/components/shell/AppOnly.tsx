"use client";
// An app-only control (T-0166). Inside the desktop app it renders the action; in a browser it renders disabled with
// the reason and the download link, never a silent no-op. Server render and hydration show the browser variant;
// detection runs on the client only (window.apprentice).
import Link from "next/link";
import { useSyncExternalStore, type ReactNode } from "react";
import { getBridge } from "@/lib/companion/transport";
import { APP_ONLY_REASON, DESKTOP_APP_HREF } from "@/lib/desktop";

const noSubscribe = () => () => {};

export function useInDesktopApp(): boolean {
  return useSyncExternalStore(noSubscribe, () => getBridge() !== null, () => false);
}

export default function AppOnly({ children, className, inApp }: { children: ReactNode; className?: string; inApp?: boolean }) {
  const detected = useInDesktopApp();
  if (inApp ?? detected) return <>{children}</>;
  return (
    <span className="inline-flex flex-col items-start gap-1" data-testid="app-only">
      <span role="button" aria-disabled="true" data-app-only="true" data-reason={APP_ONLY_REASON} title={APP_ONLY_REASON} className={`${className ?? ""} cursor-not-allowed opacity-60`}>
        {children}
      </span>
      <span className="text-xs" style={{ color: "var(--fa)" }}>
        {APP_ONLY_REASON}. <Link href={DESKTOP_APP_HREF} className="underline">Get the desktop app</Link>
      </span>
    </span>
  );
}
