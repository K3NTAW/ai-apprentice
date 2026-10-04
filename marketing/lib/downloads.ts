// The desktop app release in one place: the next release changes only this file.
// Same values as the app's src/lib/downloads.ts (marketing/ never imports from ../src). Keep in sync by copying.
export const DESKTOP_RELEASE = {
  version: "0.1.0",
  page: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/tag/v0.1.0",
  macArm64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0-arm64.dmg", size: "145 MB" },
  macX64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0.dmg", size: "153 MB" },
} as const;

/** Install and first launch of the signed, notarized build, in order. */
export const INSTALL_STEPS: readonly string[] = [
  "Open the .dmg and drag AI Apprentice to Applications.",
  "Open it. macOS asks once whether to open an app downloaded from the internet: click Open.",
  "Sign in.",
  "Grant Screen Recording, Microphone and Accessibility, then restart the app once.",
];

/** One muted line under the steps for a Mac that still blocks the app. */
export const INSTALL_FALLBACK = "Still blocked? System Settings > Privacy & Security > Open Anyway.";

/** Shown next to the macOS version line. */
export const NOTARIZED_NOTE = "Signed and notarized by Apple";

/** Which macOS build to pick. */
export const WHICH_BUILD = "Apple menu > About This Mac: Chip = Apple M… -> Apple Silicon; Processor = Intel -> Intel";
