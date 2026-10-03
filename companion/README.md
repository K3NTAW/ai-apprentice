# AI Apprentice Companion (macOS)

Menu-bar app that gives the AI Apprentice web app what a browser cannot: global typing and pointer
activity counts, the frontmost app and window title, and a halo overlay drawn over any app.
It talks only to the paired web page over a local WebSocket on `127.0.0.1`.

## Install

Requires Node 22+ and macOS (Apple silicon or Intel).

```sh
cd companion
npm install        # installs deps, then builds native deps for Electron (install-app-deps)
```

npm 11 runs install scripts only for packages listed in `allowScripts` in `package.json`. Only
`electron`, `uiohook-napi` and `get-windows` are allowed. Electron downloads its binary on first use.

## Run in development

```sh
npm run dev        # tsc build to dist/, then `electron .`
```

The app shows up as `AI` in the menu bar (no dock icon). The menu shows pairing status, the current
6-digit pairing code, `New pairing code`, missing permissions, `Pause sensing` and `Quit`.

Environment:

- `COMPANION_PORT` (default `47321`, 1024..65535). An invalid value or a port in use is shown as an
  error line in the tray menu; the app keeps running without the server.
- `COMPANION_ALLOWED_ORIGINS` comma separated, e.g. `http://localhost:3000,https://ai-apprentice*.vercel.app`.
  Unset means the defaults below. Set but empty, or with no valid entry, means deny all.

## Tests and build

```sh
npm test           # Vitest, pure modules only, no Electron runtime
npm run build      # tsc -p tsconfig.json
```

The repo root gate (`.claude/hooks/tests-green.sh`) does not run these, and the root typecheck,
lint, tests and `next build` exclude `companion/` (they pass without `companion/node_modules`).
The companion suite runs with the root script `npm run test:companion`
(`npm --prefix companion ci && npm --prefix companion test && npm --prefix companion run build`);
the Planner runs it before merge.

## Package a local unsigned .app

```sh
npm run package    # electron-builder --mac dir -> release/mac*/AI Apprentice Companion.app
```

The app is unsigned. Before first launch remove the quarantine flag:

```sh
xattr -dr com.apple.quarantine "release/mac-arm64/AI Apprentice Companion.app"
```

(or right-click the app, Open, then confirm). `LSUIElement` is set, so there is no dock icon.

## macOS permissions

Open System Settings > Privacy & Security and enable the companion (in dev: the `Electron` app
or your terminal) under:

1. **Accessibility**: required for the input hook and for reading the frontmost app.
2. **Input Monitoring**: required by macOS for global key and mouse events. Grant it in System
   Settings > Privacy & Security > Input Monitoring: click `+`, add the companion (in dev: `Electron`
   or your terminal), switch it on, then quit and relaunch the companion.
3. **Screen Recording**: required for window titles (without it titles are empty). Screen frames
   are never captured by the companion.

The tray menu lists what is missing and each item opens the right pane. Permissions are polled
every 2 s; a change re-sends `status` and starts the hook once Accessibility is granted. Restart the
app if macOS asks for it.

How `status.permissions` is derived:

- `accessibility`: `systemPreferences.isTrustedAccessibilityClient(false)`.
- `screen`: `systemPreferences.getMediaAccessStatus('screen') === 'granted'`.
- `input`: `true` when `isTrustedAccessibilityClient(false)` is true and Input Monitoring is
  granted. Where the Input Monitoring status can be queried, the query decides. Electron has no
  such query, so today `input` is **unverified until the first keystroke or click**: it is `false`
  after launch and turns `true` (with a new `status`) once the input hook has delivered at least one
  event. The hook starts as soon as Accessibility is trusted, so that first event can arrive.
- `inputVerified` (extra field in `permissions`): `true` when `input` is backed by an Input
  Monitoring query or by an observed hook event, `false` while it is unverified. If it stays
  `false` after you typed or clicked, Input Monitoring is not granted: grant it as above.

## Protocol summary

`ws://127.0.0.1:47321`, bound to loopback only, max payload 16 KiB.

Admission:

- `Origin` must exactly match the allowlist (scheme, host, port). Default allowlist:
  `http://localhost:3000`, `https://*-k3ntaws-projects.vercel.app`, `https://ai-apprentice*.vercel.app`.
  `*` is allowed only inside the host's first label and matches `[a-z0-9-]*` (never a dot); bare
  `*` or `*.domain` rules are rejected. Missing or `null` Origin is rejected.
- `Host` must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding guard).
- First message must be `{"type":"hello","token":"<6-digit code>"}` within 5 s.
- Codes come from `crypto.randomInt` and are compared in constant time. Each wrong code closes
  that connection with `4401` and counts against its Origin. After 5 failures from one Origin
  within 10 minutes, new connections from that Origin are refused with `4429` until the failures
  age out of the window. Other Origins are not affected by that lockout. On top, a global budget:
  after 20 failures across all Origins within 10 minutes, every connection and hello is refused
  with `4429` for 60 s, then the budget starts over (at most 20 guesses per ~70 s, so weeks for a
  6-digit code). The per-Origin failure map is swept on every failure and capped at 256 Origins.
  Failures never change the displayed code; it rotates only on `New pairing code` or after a
  successful pairing.
- One paired client at a time. Unauthenticated sockets do not take the paired slot, but at most 4
  may wait for hello; new connections while a client is paired are refused.

Close codes: `4401` bad or missing hello, `4403` origin or host rejected, `4408` hello timeout,
`4409` another client is paired or too many pending sockets, `4429` too many wrong codes from this Origin in the last 10 minutes, or 20 across all Origins (60 s cooldown).

Companion to web:

- `{"type":"status","version":"x.y.z","permissions":{"input":bool,"screen":bool,"accessibility":bool,"inputVerified":bool},"paused":bool}`
  after hello and on change. `paused` is an optional extension; clients that ignore it see silence
  while paused.
- `{"type":"activity","t":ms,"typing":bool,"pointer":bool,"keys":int,"clicks":int,"idle_ms":int}` every 500 ms.
- `{"type":"app","t":ms,"app":"Microsoft Outlook","title":"..."}` when app or title changes.
- `{"type":"pong"}`.

Web to companion:

- `{"type":"overlay.halo","id":"...","rect":{"x":0..1,"y":0..1,"w":0..1,"h":0..1},"text":"..."}`:
  `w,h > 0`, `x+w <= 1`, `y+h <= 1`, text clamped to 140 characters and rendered as plain text.
  Same id replaces. At most 8 halos; each lives 30 s unless re-sent.
- `{"type":"overlay.clear","id":"..."}` (id optional: clears all).
- `{"type":"ping"}`.

Invalid messages are ignored with a log line. Halos are cleared on disconnect, on pause and on quit.

## Privacy

- Activity is sent as counts only: whether a key or the pointer was used, how many keys and clicks,
  and ms since the last input. Key codes, characters and key or pointer positions are dropped at the
  hook boundary and never stored or sent.
- The frontmost app name and window title are sent when they change. Window titles can contain
  document names or email subjects; that is the one piece of content the companion sends.
- `Pause sensing` stops the input hook and the app poll, clears halos and sends nothing but `status`
  (with `paused: true`). No app or title is sent while paused.
- Nothing leaves the machine except to the paired local web page over `127.0.0.1`. No files, no
  telemetry, no network calls.

## Build choices

- **Plain `tsc`, no bundler**: the main process is a handful of modules; electron-vite would add a
  Vite toolchain for nothing. Sources are `.mts` (ESM, emitted as `.mjs`) because `get-windows` is
  ESM-only and Electron supports an ESM main process. The sandboxed preload is `.cts` (CommonJS),
  which sandboxed preloads require. The overlay page is static HTML, CSS and a small script.
  The `.mts` extension also keeps these files out of the root Next.js `tsconfig.json`
  (`include: **/*.ts`), so root typecheck and `next build` never see Electron imports.
- **electron-builder** for packaging: `asarUnpack` for the native modules, `npmRebuild`, `LSUIElement`
  via `extendInfo`, `dir` target for an unsigned local `.app`.
- **uiohook-napi** for global input: maintained N-API binding of libuiohook with prebuilds for
  macOS arm64/x64, so no per-Electron rebuild is needed. Alternatives (iohook) are unmaintained.
- **get-windows** (formerly active-win) for the frontmost app and title, called with
  permission prompts disabled and only when Accessibility is granted.
- Single-instance lock: a second launch quits immediately.

## Rollback

The change is additive: everything lives in `companion/` plus `docs/checks/pivot-companion.md` and
a few `.gitignore` lines. Revert the commit to remove it.
