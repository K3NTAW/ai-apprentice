import Link from "next/link";
import type { ReactNode } from "react";
import BrandMark from "@/components/landing/BrandMark";
import { LoginMarketingLink } from "@/components/landing/Landing";

/** Login.dc.html frame: brand, 'What is AI Apprentice?' (the marketing site, when configured, browser only) and the centred 440 px card. */
export default function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex flex-wrap items-center justify-between gap-4 px-8 py-[22px]">
        <Link href="/login" className="flex items-center gap-2.5 text-base font-semibold" style={{ color: "var(--tx)" }}>
          <BrandMark />
          AI Apprentice
        </Link>
        <LoginMarketingLink />
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pt-8 pb-24">
        <div className="ui-card flex w-full max-w-[440px] flex-col gap-6 px-9 py-10" style={{ boxShadow: "var(--sh)" }}>
          {children}
        </div>
      </main>
    </div>
  );
}
