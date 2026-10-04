import type { Metadata } from "next";
import localFont from "next/font/local";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

// Same fonts as the app: Geist and Geist Mono from the geist package, Instrument Serif copied into components/ui/fonts.
const instrumentSerif = localFont({
  src: "../components/ui/fonts/InstrumentSerif-Italic.ttf",
  style: "italic",
  weight: "400",
  variable: "--font-instrument-serif",
});

// ?theme=light|dark forces the theme (design compare shots); otherwise the OS preference. Static, nothing echoed.
const THEME_PARAM = `(function(){var t=new URLSearchParams(location.search).get("theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)})()`;

export const metadata: Metadata = {
  title: "AI Apprentice",
  description: "Keep the judgment when the expert retires.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} ${instrumentSerif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_PARAM }} />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
