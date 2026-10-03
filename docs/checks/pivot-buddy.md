# Manual checks: pivot-buddy (cursor buddy, pointing, shortcuts, floating panel)

Run on macOS AND on Windows 11 x64 with the web app on `http://localhost:3000`.
macOS: `cd companion && npm install && npm run dev`. Windows: `npm install && npm run package:win`,
install `release/*.exe`, or `npm run dev` from a Windows checkout.

Automated: `npm run test:companion` from the repo root covers `companion/` (buddy reducer, shortcuts,
panel view model, app_url check, protocol v2). `.claude/hooks/tests-green.sh` covers the root app only.
Windows was not available when this was built; record the OS and build for each run below.

Send messages from the paired page console (see `pivot-companion.md` item 4 for pairing), for example
`ws.send(JSON.stringify({type:"buddy.say",text:"Hello"}))`.

1. **First run panel**: launch. The panel opens (380x520, rounded, no system frame) with the pairing
   code. macOS: vibrancy, permission buttons if missing. Windows 11: Mica, no permission section.
   Switch OS light/dark mode: the panel follows. Drag it by the title area. `×` hides it.
2. **Panel toggle**: `Option+Shift+A` (Windows `Alt+Shift+A`) and the tray (Windows: left click)
   show and hide it. Pairing switches the panel to the session view.
3. **Buddy follows the cursor**: a small blue orb trails the cursor with a soft offset and eased
   motion. Move across two displays: it follows on each. Clicks pass through it; typing in another app
   never loses focus. Unplug or rearrange a display: the buddy still follows.
4. **States**: send `buddy.state` idle, listening, thinking, speaking, paused: dim breathe, pulse,
   orbiting dots, waveform ring, grey with slash.
5. **Say**: `buddy.say` with 280 characters wraps next to the buddy, never covers the cursor tip,
   flips near the right and bottom edges and fades after 6 s (or `ttl_ms`). A second say replaces it.
6. **Glance**: `{type:"buddy.point",id:"g",rect:{x:0.4,y:0.4,w:0.2,h:0.1},style:"glance"}`: the buddy
   flies on a curve to the rect, rests about 1.2 s, flies back to the cursor. No halo.
7. **Stop**: same with `style:"stop",text:"Not this field"`: halo and bubble appear and stay;
   `buddy.state` changes keep them; `buddy.clear` with `id` removes them. `overlay.halo` behaves as stop.
8. **Screen share exclusion**: start Capture (whole screen) in the web app while a stop halo is shown;
   the captured frame preview does not contain the buddy, bubble or halo. Note the OS version if it does.
9. **Shortcuts**: hold `Option+Space` (Windows `Alt+Space`): the page logs `shortcut talk_start`, on
   release `talk_end`. `Option+Shift+O/E/P` log `off_record_toggle`, `end_task`, `pause_toggle`.
   Unpaired: each shows the bubble `Open the control room to start a session`.
10. **Stuck key**: hold talk, then lock the screen, or toggle tray `Pause sensing`, or close the page:
    `talk_end` is sent (or the page sees the disconnect). Hold for over 60 s: `talk_end` arrives at 60 s.
11. **No Input Monitoring (macOS)**: revoke it and relaunch: the panel says press once to talk, again
    to stop; talk works as a toggle.
12. **Failed registration**: let another app take `Option+Space` (e.g. Raycast or Alfred) and relaunch:
    the panel shows `Could not register` next to Hold to talk. Rebind it in the panel: the error goes
    away and the new binding works after a relaunch too.
13. **Panel session**: send `session.state` with mode, title, counters, last question and answer:
    the panel shows them as plain text (try `<b>x</b>`, it shows literally). `Pause`, `Off the record`,
    `End task` buttons send the same shortcut messages. `Open control room` opens `app_url` only for an
    allowed origin; with `app_url:"https://evil.com"` the button is disabled.
14. **Rollback**: `COMPANION_BUDDY=0 npm run dev`: no buddy or bubbles; a stop still draws the halo.
15. **Privacy**: while typing and using shortcuts, `activity` still carries counts only; no key names
    or codes appear in any message or in the terminal log.
