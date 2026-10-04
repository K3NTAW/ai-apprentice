// Controls that still render without an action, each with the reason. Must match "## Remaining" in
// docs/checks/interaction-audit.md (checked by src/app/interaction.guard.test.tsx). Shrink, never grow quietly.
export const ALLOWLIST: Array<{ key: string; reason: string }> = [];
