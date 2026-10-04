// Frame for the pages around the landing (download, privacy, imprint): brand, back to the landing, the footer.
import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import { ctaFor } from "@/lib/site";
import BrandMark from "./BrandMark";
import SiteFooter from "./SiteFooter";

export default function SitePage({ appUrl, screen, children }: { appUrl: string | null; screen: string; children: ReactNode }) {
  const cta = ctaFor(appUrl);
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)" }} data-screen={screen}>
      <header className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-4 px-5 py-[22px] sm:px-8">
        <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-[-0.01em]" style={{ color: "var(--tx)" }}>
          <BrandMark />
          AI Apprentice
        </Link>
        {cta.signIn && <a className={buttonClass("secondary")} href={cta.signIn}>Sign in</a>}
      </header>
      <main className="mx-auto flex w-full max-w-[880px] flex-1 flex-col gap-8 px-5 pt-10 pb-24 sm:px-8">{children}</main>
      <SiteFooter />
    </div>
  );
}
