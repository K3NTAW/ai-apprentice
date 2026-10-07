# Desktop release (macOS, signed and notarized)

How the companion app (`companion/`) gets signed, notarized and uploaded as a draft release. The
workflow is `.github/workflows/desktop-release.yml`, guarded by `e2e/desktop-release.guard.test.ts`.
Nothing is published by the workflow: it only creates a draft on `K3NTAW/ai-apprentice-desktop`.
Publishing is a human step.

## One-time setup (personal Apple Developer account)

1. **Developer ID Application certificate.** In the Apple Developer portal (Certificates, Identifiers
   & Profiles), create a "Developer ID Application" certificate for the personal account and install
   it in Keychain Access on your Mac.
2. **Export it as .p12.** In Keychain Access, select the certificate together with its private key,
   File > Export Items, format `.p12`, set an export password.
3. **CSC_LINK and CSC_KEY_PASSWORD.** Run `base64 -i cert.p12 | pbcopy`; the clipboard content is the
   `CSC_LINK` secret. The export password is `CSC_KEY_PASSWORD`. Delete the local `.p12` afterwards.
4. **App Store Connect API key** (for notarization). App Store Connect > Users and Access >
   Integrations > App Store Connect API, create a key with the **Developer** role and download the
   `.p8` (downloadable once). This gives:
   - `APPLE_API_KEY_P8`: the full contents of the `.p8` file (including the BEGIN/END lines),
   - `APPLE_API_KEY_ID`: the key ID,
   - `APPLE_API_ISSUER`: the issuer ID shown above the key list.
5. **DESKTOP_RELEASE_TOKEN.** On GitHub, create a fine-grained personal access token with access to
   `K3NTAW/ai-apprentice-desktop` only and repository permission **Contents: Read and write**.
6. **Add the secrets** in the app repo: Settings > Secrets and variables > Actions > New repository
   secret, by these names:

   | Secret | Value |
   | --- | --- |
   | `CSC_LINK` | base64 of the `.p12` |
   | `CSC_KEY_PASSWORD` | the `.p12` export password |
   | `APPLE_API_KEY_P8` | contents of `AuthKey_XXXX.p8` |
   | `APPLE_API_KEY_ID` | API key ID |
   | `APPLE_API_ISSUER` | API issuer ID |
   | `DESKTOP_RELEASE_TOKEN` | fine-grained token, contents: write on `K3NTAW/ai-apprentice-desktop` |
   | `SENTRY_DSN_ELECTRON` (optional) | Electron project DSN, once Needs-the-human 3 (the Sentry project) is done; unset means no crash reports |

No key leaves GitHub secrets. Signing and notarization run only on the GitHub Actions runner: the
`.p12` goes into a temporary keychain that electron-builder removes, the `.p8` is written to
`$RUNNER_TEMP` and deleted at the end of the job (also on failure). No agent signs locally, and the
orchestrator `with-tokens.sh` allowlist is **not** used for releases.

## Release procedure

1. On a branch, bump `version` in `companion/package.json` (for example `0.2.0`), open a PR, merge it
   to the default branch.
2. Actions > Desktop release > Run workflow, branch: the **default branch**, version: the same
   string (`0.2.0`, no `v`). The run fails if it is started from any other branch, if the version is
   not semver, or if it differs from `companion/package.json`.
3. The run builds, writes `companion/app.config.json` with `updates: true` (and `sentryDsn` when the
   secret is set), signs, notarizes and creates a **draft** release `v0.2.0` on
   `K3NTAW/ai-apprentice-desktop` targeting the commit that was built, with the dmg, zip, blockmap
   files and `latest-mac.yml`.
4. Open the draft on `K3NTAW/ai-apprentice-desktop`, check the assets (arm64 and x64 dmg and zip,
   `latest-mac.yml`), then **Publish**. The updater only sees published releases, so nothing reaches
   users before this step.

Note: `--target "$GITHUB_SHA"` names a commit of the app repo. If `K3NTAW/ai-apprentice-desktop` does
not contain that commit, `gh release create` fails with a validation error; check this on the first run.

## Rollback

- Unpublishing (back to draft) or deleting the release stops **new** downloads and update checks from
  finding it.
- It does **not** undo updates already installed: apps that updated keep the bad version.
- The fix for a bad release is to publish a **higher** version (bump, merge, run, publish). The
  updater never downgrades.

## Human acceptance, not part of the gate

These need a real Mac and cannot run in CI:

- A fresh Mac (or a user account that never ran the app) downloads the dmg from the release, opens it
  and launches the app with **no Gatekeeper warning**.
- Updating from the previous signed build keeps the **Screen Recording** permission (and the other
  TCC grants): same bundle id `app.aiapprentice.companion`, same Developer ID, so macOS keeps them.
  Until this is verified, keep the `xattr`/`tccutil` instructions in `companion/README.md`
  ("Unsigned local builds").

## What the app sends

- **Update checks** (signed releases only, when the release config has `updates: true`): at start and
  every 6 hours the app fetches `latest-mac.yml` from the GitHub releases of
  `K3NTAW/ai-apprentice-desktop`, downloads a newer version in the background and installs it on quit.
- **Crash reports** (only when the release config carries a `sentryDsn`): sent to Sentry with PII
  scrubbed: no breadcrumbs, no screenshots, home paths rewritten to `~`.
- **Local and unsigned builds** (`npm run dev`, `npm run package`, `package:dir`, `package:win`) send
  neither: their `app.config.json` has no `updates` or `sentryDsn`.
- There is no in-app opt-out yet. See the Privacy section of `companion/README.md`.

## Windows

The Windows build stays unsigned: NSIS installer via `npm run package:win`, no auto-update, no
release workflow. Defender SmartScreen shows a warning on first run ("More info", "Run anyway"); this
is expected until a Windows code-signing certificate exists.
