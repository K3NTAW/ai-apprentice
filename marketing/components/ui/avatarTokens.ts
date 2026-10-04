// Avatar colour tokens from globals.css (--avatar-*). The avatar SVG is shown as an <img> data URL, so it needs the
// literal values; avatarTokens.test.ts keeps this copy equal to globals.css.
export const AVATAR_TOKENS = {
  "--avatar-pip-body": "#ECEAE5",
  "--avatar-pip-accent": "#3A4EFD",
} as const;
