// Public site settings from env. NEXT_PUBLIC_* are read as literal process.env.X expressions because Next inlines
// only literal access. A value counts only when it is an http(s) URL; anything else is treated as unset.
import { DESKTOP_RELEASE } from "./downloads";

export function cleanUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/** The app (root Next.js project, its own Vercel deployment). */
export function appUrl(): string | null {
  return cleanUrl(process.env.NEXT_PUBLIC_APP_URL);
}

/** 'Sign in' and 'Open the app' targets. Without NEXT_PUBLIC_APP_URL: no 'Sign in', and the main CTA is the download. */
export function ctaFor(app: string | null): { signIn: string | null; open: { label: string; href: string } } {
  if (!app) return { signIn: null, open: { label: "Download", href: "/download" } };
  return { signIn: new URL("/login", app).href, open: { label: "Open the app", href: app } };
}

export type DownloadId = "mac-arm64" | "mac-x64" | "win";
export type Download = {
  id: DownloadId;
  os: string;
  label: string;
  detail: string;
  /** null: 'Coming soon', no link. */
  href: string | null;
  size: string | null;
  recommended: boolean;
};

/** The three builds in a fixed order, from the release in lib/downloads.ts. Windows has no build yet. */
export function downloads(): Download[] {
  const r = DESKTOP_RELEASE;
  return [
    { id: "mac-arm64", os: "macOS", label: "Apple silicon", detail: "M1 and later", href: r.macArm64.href, size: r.macArm64.size, recommended: true },
    { id: "mac-x64", os: "macOS", label: "Intel", detail: "Intel Macs", href: r.macX64.href, size: r.macX64.size, recommended: false },
    { id: "win", os: "Windows", label: "Windows", detail: "Windows 10 and 11, 64-bit", href: null, size: null, recommended: false },
  ];
}
