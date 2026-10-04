// The desktop app release in one place: the next release changes only this file.
// Same values as the app's src/lib/downloads.ts (marketing/ never imports from ../src). Keep in sync by copying.
export const DESKTOP_RELEASE = {
  version: "0.1.0",
  page: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/tag/v0.1.0",
  macArm64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0-arm64.dmg", size: "145 MB" },
  macX64: { href: "https://github.com/K3NTAW/ai-apprentice-desktop/releases/download/v0.1.0/AI.Apprentice-0.1.0.dmg", size: "153 MB" },
} as const;

/** First launch of the ad-hoc signed, non-notarized build, in order. `code` is a line to copy into Terminal. */
export const INSTALL_STEPS: readonly { text: string; code?: string }[] = [
  { text: "Open the .dmg and drag AI Apprentice to Applications." },
  {
    text: "First launch: macOS says it cannot verify the app. Click Done, open System Settings > Privacy & Security and click Open Anyway. Or right-click the app and choose Open.",
  },
  { text: "If macOS says the app is damaged, run this once in Terminal:", code: 'xattr -cr "/Applications/AI Apprentice.app"' },
  { text: "Sign in." },
  { text: "Grant Screen Recording, Microphone and Accessibility, then restart the app once." },
];

/** Which macOS build to pick. */
export const WHICH_BUILD = "Apple menu > About This Mac: Chip = Apple M… -> Apple Silicon; Processor = Intel -> Intel";
