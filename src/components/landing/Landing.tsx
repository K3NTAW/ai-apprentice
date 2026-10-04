"use client";

// The marketing landing moved to its own project (marketing/, deployed as a separate Vercel project, see
// docs/DEPLOY.md). What stays in the app is the way back to it: the marketing site URL and the small
// 'What is AI Apprentice?' link on the login screen, in a browser only: inside the desktop app (window.apprentice)
// it is not rendered. No hex colours here (home.test.tsx design fidelity).
import { useSyncExternalStore } from "react";
import { buttonClass } from "@/components/ui";
import { getBridge } from "@/lib/companion/transport";

/** NEXT_PUBLIC_MARKETING_URL when it is an http(s) URL, else null (the link is then hidden). Literal access: Next inlines it. */
export function marketingUrl(raw: string | undefined = process.env.NEXT_PUBLIC_MARKETING_URL): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The marketing link shows in a browser, never inside the desktop app (window.apprentice present). */
export function showMarketingLink(win: unknown): boolean {
  return getBridge(win) === null;
}

/** Hidden when inApp or without an http(s) href. */
export function MarketingLink({ href = marketingUrl(), inApp = false }: { href?: string | null; inApp?: boolean }) {
  if (!href || inApp) return null;
  return (
    <a href={href} className={buttonClass("ghost", "md", "h-9")}>
      What is AI Apprentice?
    </a>
  );
}

const noSubscribe = () => () => {};
const browserSnapshot = () => showMarketingLink(window);
const hiddenSnapshot = () => false;

/** The login header's link. Hidden by default: the server render and the hydration render emit nothing, the
 *  browser shows it right after mount, the desktop app (window.apprentice) never does. */
export function LoginMarketingLink({ href = marketingUrl() }: { href?: string | null }) {
  const show = useSyncExternalStore(noSubscribe, browserSnapshot, hiddenSnapshot);
  return <MarketingLink href={href} inApp={!show} />;
}
