// Public site settings from env. NEXT_PUBLIC_* are read as literal process.env.X expressions because Next inlines
// only literal access. A value counts only when it is an http(s) URL; anything else is treated as unset.

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
export type Download = { id: DownloadId; os: string; label: string; detail: string; href: string | null };

export type DownloadEnv = { macArm64?: string; macX64?: string; win?: string };

export function downloadEnv(): DownloadEnv {
  return {
    macArm64: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_ARM64,
    macX64: process.env.NEXT_PUBLIC_DOWNLOAD_MAC_X64,
    win: process.env.NEXT_PUBLIC_DOWNLOAD_WIN,
  };
}

/** The three builds in a fixed order. href null: 'Private beta', no link. */
export function downloads(env: DownloadEnv): Download[] {
  return [
    { id: "mac-arm64", os: "macOS", label: "Apple silicon", detail: "M1 and later", href: cleanUrl(env.macArm64) },
    { id: "mac-x64", os: "macOS", label: "Intel", detail: "Intel Macs", href: cleanUrl(env.macX64) },
    { id: "win", os: "Windows", label: "Windows", detail: "Windows 10 and 11, 64-bit", href: cleanUrl(env.win) },
  ];
}
