import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_TOKENS } from "./avatarTokens";

const css = readFileSync(fileURLToPath(new URL("../../app/globals.css", import.meta.url)), "utf8");

describe("avatar tokens", () => {
  it("equal the --avatar-* tokens in globals.css", () => {
    for (const [k, v] of Object.entries(AVATAR_TOKENS)) expect(css).toContain(`${k}: ${v};`);
  });
});
