import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { connection } from "next/server";
import { Suspense } from "react";
import NavProgress from "@/components/ui/NavProgress";
import { appMode } from "@/lib/supabase/env";
import "./globals.css";

// Fonts are self-hosted: Geist and Geist Mono from the geist package, Instrument Serif (expert quotes) from src/components/ui/fonts.
const instrumentSerif = localFont({
  src: "../components/ui/fonts/InstrumentSerif-Italic.ttf",
  style: "italic",
  weight: "400",
  variable: "--font-instrument-serif",
});

// Local mode only: ?theme=light|dark forces the theme (headless design compare shots); a static script, no user input is echoed.
const THEME_PARAM = `(function(){var t=new URLSearchParams(location.search).get("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)})()`;

const FONT_CLASS = `${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`;

export const metadata: Metadata = {
  title: "AI Apprentice",
};

// The mode is read per request, never baked in at build time (the build runs with NODE_ENV=production).
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const mode = appMode();
  const misconfigured = mode === "misconfigured";
  const themeOverride = mode === "local";
  // The override script sets data-theme on <html> before hydration, so only <html> suppresses the warning, and only then.
  return (
    <html lang="en" className={FONT_CLASS} suppressHydrationWarning={themeOverride || undefined}>
      <head>{themeOverride && <script dangerouslySetInnerHTML={{ __html: THEME_PARAM }} />}</head>
      <body className="antialiased">
        {misconfigured && (
          <div role="alert" className="border-b border-amber-300 bg-amber-50 px-8 py-2 text-sm text-amber-900">
            Setup incomplete: Supabase is not configured on this deployment. See docs/DEPLOY.md.
          </div>
        )}
        <Suspense fallback={null}>
          <NavProgress />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
