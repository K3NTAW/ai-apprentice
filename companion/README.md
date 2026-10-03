# AI Apprentice Companion (macOS and Windows)

Tray app that gives the AI Apprentice web app what a browser cannot: global typing and pointer
activity counts, the frontmost app and window title, a cursor buddy that talks and points at things
over any app, global push-to-talk shortcuts and a small floating panel.
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

The app shows up as a ring icon with `AI` in the menu bar. The menu shows pairing status, the current
6-digit pairing code, `New pairing code`, `Show pairing window`, missing permissions, `Pause sensing`
and `Quit`.

On launch the companion opens the floating panel (in the Dock while open). Its first-run view shows
the pairing code in large digits and `New code`; after pairing it shows the session (see below).
On launch and on every new code it prints one line to stdout:

```
[companion] pairing code: 123 456 (enter it in the web app)
```

### Can't find the menu-bar item?

On a MacBook with a notch and a full menu bar, macOS hides menu-bar items that do not fit, and the
companion's item may be one of them. Use the panel (open on launch, `Option+Shift+A` toggles it, or
click the companion in the Dock while it is open) or read the code from the terminal line above. Quitting other
menu-bar apps or shortening their titles also brings the item back.

Environment:

- `COMPANION_PORT` (default `47321`, 1024..65535). An invalid value or a port in use is shown as an
  error line in the tray menu; the app keeps running without the server.
- `COMPANION_BUDDY=0` (or `off`, `false`): rollback switch. No cursor buddy, no bubbles, no glances;
  `stop` points and `overlay.halo` still draw the v1 halo. Same as unticking `Cursor buddy` in the panel.
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

## Cursor buddy, panel and shortcuts

- **Buddy**: an 18 px brand-blue orb next to the cursor, drawn in one transparent, click-through,
  non-focusable, always-on-top overlay window per display. States from `buddy.state`: idle (dim
  breathe), listening (pulse), thinking (orbiting dots), speaking (waveform ring), paused (grey with a
  slash). The cursor is polled with `screen.getCursorScreenPoint` every 16 ms only while the buddy is
  enabled, shown, not paused and paired (or a local bubble is up); otherwise the poll stops. Overlays
  follow `display-added`, `display-removed` and `display-metrics-changed`.
- **Bubble**: `buddy.say` shows up to 280 characters right-below the buddy (flipped at the display
  edge), never over the cursor hotspot, and fades after `ttl_ms` (default 6 s).
- **Pointing**: `buddy.point` flies the buddy on a curve (400 ms) to the rect on the primary display.
  `glance` rests 1.2 s and flies back; `stop` draws the halo plus bubble and stays until `buddy.clear`
  or the same id is re-sent. `overlay.halo` is mapped to `stop` in `protocol.mts` (with its v1 30 s TTL).
- **Precedence** (`buddy.mts`, a pure reducer with an injected clock): say replaces say; a new point
  replaces an in-flight glance and the stop with the same id (one halo per id, at most 8); `buddy.state`
  never cancels a stop; `buddy.clear` without id clears say, glance and stops. `ttl_ms` is clamped to
  100..30000. `buddy.mts` supersedes the old halo list for drawing; `overlay.mts` stays the rect
  validation and mapping helper.
- **Screen capture**: overlay windows use `setContentProtection(true)`, so on macOS and Windows the
  buddy, bubble and halo are left out of screen captures, including the whole-monitor
  `getDisplayMedia` frames the web app sends to vision. Where the OS ignores it (older macOS builds
  with some capture paths), the Capture side sees a small blue orb and an amber halo; vision prompts
  must treat those as companion UI, not part of the user's app.
- **Panel**: 380x520, frameless with a drag area, vibrancy on macOS, Mica on Windows 11 22H2+, solid
  elsewhere; light and dark follow the OS. Shows pairing (first run), mode and title, last question and
  answer, questions and guardrail counters, `Pause`, `Off the record`, `End task` (same as the
  shortcuts), `Open control room` (only when `app_url` passes the check below), macOS permissions and
  the shortcut settings. Toggle it from the tray (Windows: left click) or `Option+Shift+A` / `Alt+Shift+A`.
- **`app_url`** (`appUrl.mts`): `new URL`, `https` (or `http` for `localhost`/`127.0.0.1`), no
  userinfo, `isOriginAllowed(url.origin)` against the same allowlist as WebSocket clients; the
  normalised `href` is opened.

Shortcuts (configurable in the panel, saved to `settings.json` in the app's userData folder):

| Action | macOS | Windows | Sent |
| --- | --- | --- | --- |
| Talk (hold) | `Option+Space` | `Alt+Space` | `talk_start` on press, `talk_end` on release |
| Off the record | `Option+Shift+O` | `Alt+Shift+O` | `off_record_toggle` |
| End task | `Option+Shift+E` | `Alt+Shift+E` | `end_task` |
| Pause | `Option+Shift+P` | `Alt+Shift+P` | `pause_toggle` |
| Panel | `Option+Shift+A` | `Alt+Shift+A` | local only |

- Without a paired page a shortcut shows the bubble `Open the control room to start a session`.
- Press is `globalShortcut`; release comes from a uiohook `keyup` listener in `shortcuts.mts`, the
  only module that reads keycodes: it compares the keycode with the talk binding's key, calls release
  on a match and keeps nothing. `activity.mts` still never sees keycodes or `keyup`.
- Without the input hook (macOS Input Monitoring or Accessibility missing) talk falls back to
  press-to-toggle and the panel says so.
- While paused (tray `Pause sensing`, or `buddy.state` paused) talk is blocked with a bubble; pause,
  off the record, end task and the panel shortcut keep working.
- `talk_end` is always sent when a hold ends early: pause, unpair or disconnect, screen lock or sleep,
  input hook stop, and after a hard 60 s cap.
- A failed `globalShortcut.register` (taken by the system or another app) is shown next to that
  binding in the panel and logged; pick another binding there.

## Package a local unsigned .app

```sh
npm run package    # electron-builder --mac dir -> release/mac*/AI Apprentice Companion.app
```

The app is unsigned. Before first launch remove the quarantine flag:

```sh
xattr -dr com.apple.quarantine "release/mac-arm64/AI Apprentice Companion.app"
```

(or right-click the app, Open, then confirm). `LSUIElement` is set, so there is no dock icon.

## Windows

`npm run package:win` (`electron-builder --win nsis --x64`) builds an unsigned NSIS installer in
`release/`. Build it on Windows x64 with Node 22+ (`npm install`, then `npm run package:win`), or in
a CI job on `windows-latest` running the same two commands; `uiohook-napi` and `get-windows` ship
Windows x64 prebuilds and `npmRebuild` rebuilds them for Electron. Cross-building from macOS needs
Wine and is not supported here.

On Windows: no permission UI (there are no such prompts), the tray uses `static/icon.ico` and a left
click toggles the panel, the panel uses Mica on Windows 11 22H2+ and a solid background elsewhere.
`Alt+Space` replaces the window system menu shortcut while the companion runs.

**Verified on which OS**: everything here was written and unit-tested on macOS (Apple silicon). The
Windows installer build and the `uiohook-napi` / `get-windows` runtime on Windows are NOT verified:
no Windows machine or Windows CI run exists for this repo yet. `docs/checks/pivot-buddy.md` lists the
manual checks to run on both.

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

- `{"type":"status","version":"x.y.z","protocol":2,"permissions":{"input":bool,"screen":bool,"accessibility":bool,"inputVerified":bool},"paused":bool}`
  after hello and on change. `protocol: 2` means the v2 messages below are understood; a page that
  sees no `protocol` field talks to a v1 companion and should only send `overlay.*`. `paused` is an optional extension; clients that ignore it see silence
  while paused.
- `{"type":"activity","t":ms,"typing":bool,"pointer":bool,"keys":int,"clicks":int,"idle_ms":int}` every 500 ms.
- `{"type":"app","t":ms,"app":"Microsoft Outlook","title":"..."}` when app or title changes.
- `{"type":"pong"}`.
- v2: `{"type":"shortcut","action":"talk_start"|"talk_end"|"off_record_toggle"|"pause_toggle"|"end_task"}`.

Web to companion:

- `{"type":"overlay.halo","id":"...","rect":{"x":0..1,"y":0..1,"w":0..1,"h":0..1},"text":"..."}`:
  `w,h > 0`, `x+w <= 1`, `y+h <= 1`, text clamped to 140 characters and rendered as plain text.
  Same id replaces. At most 8 halos; each lives 30 s unless re-sent.
- `{"type":"overlay.clear","id":"..."}` (id optional: clears all).
- `{"type":"ping"}`.
- v2: `{"type":"buddy.state","state":"idle"|"listening"|"thinking"|"speaking"|"paused"}`.
- v2: `{"type":"buddy.say","text":"<1..280>","ttl_ms":n}` (ttl optional, default 6000, clamped 100..30000).
- v2: `{"type":"buddy.point","id":"...","rect":{...},"text":"<max 140>","style":"glance"|"stop","ttl_ms":n}`
  (rect rules as for halos; a stop without `ttl_ms` stays until cleared).
- v2: `{"type":"buddy.clear","id":"..."}` (id optional: clears all).
- v2: `{"type":"session.state","mode":"capture"|"teach"|null,"title":"<200","expert":"<200","asked":int,"guardrails":int,"last_question":"<500","last_answer":"<2000","off_record":bool,"app_url":"<2048"}`;
  counters are integers 0..1000000. Too long texts, bad enums or counters reject the whole message.

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

Buddy problems on a machine: set `COMPANION_BUDDY=0` or untick `Cursor buddy` in the panel. That
falls back to the halo-only overlay and does not block Capture.

The change is additive: everything lives in `companion/` plus `docs/checks/pivot-companion.md` and
a few `.gitignore` lines. Revert the commit to remove it.
