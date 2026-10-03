import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { connection } from "next/server";
import { appMode } from "@/lib/supabase/env";
import "./globals.css";

// Fonts are self-hosted: Geist and Geist Mono from the geist package, Instrument Serif (expert quotes) from src/components/ui/fonts.
const instrumentSerif = localFont({
  src: "../components/ui/fonts/InstrumentSerif-Italic.ttf",
  style: "italic",
  weight: "400",
  variable: "--font-instrument-serif",
});

const FONT_CLASS = `${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`;

export const metadata: Metadata = {
  title: "AI Apprentice",
};

// The mode is read per request, never baked in at build time (the build runs with NODE_ENV=production).
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await connection();
  const misconfigured = appMode() === "misconfigured";
  return (
    <html lang="en" className={FONT_CLASS}>
      <body className="antialiased">
        {misconfigured && (
          <div role="alert" className="border-b border-amber-300 bg-amber-50 px-8 py-2 text-sm text-amber-900">
            Setup incomplete: Supabase is not configured on this deployment. See docs/DEPLOY.md.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
