// Local mode onboarding state: <DATA_DIR>/onboarding.json. A missing or corrupt file is a fresh state.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/store/file";
import { emptyState, parseState, type OnboardingState } from "./state";

export const onboardingFile = () => path.join(dataDir(), "onboarding.json");

export async function readLocalOnboarding(): Promise<OnboardingState> {
  try {
    return parseState(JSON.parse(await readFile(onboardingFile(), "utf8")));
  } catch {
    return emptyState();
  }
}

export async function writeLocalOnboarding(s: OnboardingState): Promise<void> {
  const file = onboardingFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 1));
  await rename(tmp, file);
}
