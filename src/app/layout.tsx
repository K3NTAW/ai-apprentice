import type { Metadata } from "next";
import { connection } from "next/server";
import { appMode } from "@/lib/supabase/env";
import "./globals.css";

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
    <html lang="en">
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
