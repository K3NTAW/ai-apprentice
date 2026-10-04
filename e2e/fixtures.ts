// Seed ids shared with e2e/seed.mjs, plus the shell expectations every app screen carries.
import type { Result } from "./coverage";

export const AGENT_A = "0e2e0000-0000-4000-8000-00000000000a";
export const AGENT_B = "0e2e0000-0000-4000-8000-00000000000b";
export const MAP_SESSION = "e2e-map-confirmed";
export const DEBRIEF_SESSION = "e2e-debrief-open";
export const TEACH_SESSION = "e2e-teach-learner";

export const SHELL: Record<string, Result> = {
  "AI Apprentice home": "url",
  Agents: "url",
  Learn: "url",
  Workspace: "url",
  "Get the desktop app": "url",
  "Start capture": "url",
  "/^(Teach|Work Map) · /": "url",
  "Account and workspace": "url",
  "Open user menu": "state",
  "/^(Dark|Light) theme$/": "state",
};
