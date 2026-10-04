// The desktop app release in one place: the next release changes only this file.
// Same values as marketing/lib/downloads.ts (the marketing site never imports from src/). Keep in sync by copying.
export const DESKTOP_RELEASE = {
  version: "0.1.0",
  page: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/tag/v0.1.0",
  macArm64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0-arm64.dmg", size: "130 MB" },
  macX64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0.dmg", size: "134 MB" },
} as const;

/** First launch of the unsigned build, in order. */
export const INSTALL_STEPS = [
  "Open the .dmg and drag AI Apprentice to Applications.",
  "First launch: right-click AI Apprentice in Applications and choose Open. Or open System Settings > Privacy & Security and click Open Anyway.",
  "Sign in.",
  "Grant Screen Recording, Microphone and Accessibility, then restart the app once.",
] as const;

/** The app's 'Get the desktop app' page. */
export const DOWNLOAD_HREF = "/download";
