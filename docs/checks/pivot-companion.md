# Manual checks: pivot-companion (desktop companion)

Run on macOS with the web app on `http://localhost:3000` and `cd companion && npm install && npm run dev`.

Automated: the root gate does not cover `companion/`. The companion suite runs with
`npm run test:companion` from the repo root (`npm --prefix companion ci && npm --prefix companion test
&& npm --prefix companion run build`); the Planner runs it before merge.

1. **Menu bar**: `AI` appears in the menu bar, no dock icon. Menu shows `Not paired`, a pairing code,
   `New pairing code`, `Pause sensing`, `Quit`. A second `npm run dev` exits at once (single instance).
2. **Permissions missing**: on a fresh machine the menu lists `Grant Accessibility…`,
   `Check Input Monitoring…`, `Grant Screen Recording (window titles)…`; each opens the matching
   System Settings pane.
3. **Permissions granted**: enable Accessibility, Input Monitoring and Screen Recording. Within a few
   seconds the missing items disappear, without any key or mouse move, and the web app console
   shows a new `status` with all three `true`.
4. **Pairing from the web app console**:
   `ws = new WebSocket("ws://127.0.0.1:47321"); ws.onmessage = e => console.log(e.data); ws.onclose = e => console.log("closed", e.code); ws.onopen = () => ws.send(JSON.stringify({type:"hello",token:"<code>"}))`
   logs `status`; the tray shows `Paired with web app` and a new code. A wrong code logs `closed 4401`;
   after five wrong codes the next connection from that page logs `closed 4429` (for 10 minutes), the
   tray code stays the same, and a page on another allowed Origin still pairs. No hello for 5 s logs `closed 4408`.
   A second tab while paired logs `closed 4409`. The same snippet from `https://example.com` logs `closed 4403`.
5. **Activity while typing in another app**: with the page paired, type in TextEdit or Outlook.
   The console shows `activity` every 500 ms with `typing:true` and `keys>0`; stop and `idle_ms` grows.
   Inspect several messages: only `type,t,typing,pointer,keys,clicks,idle_ms`, no characters or key codes.
6. **App switch events**: switch Outlook -> Excel -> browser; each switch logs one `app` message with
   the app name and window title, and no repeats while staying in the same window.
7. **Halo**: open Outlook (or any app, also full screen) and send
   `ws.send(JSON.stringify({type:"overlay.halo",id:"h1",rect:{x:0.3,y:0.3,w:0.4,h:0.2},text:"Check the recipient first"}))`.
   A pulsing rounded halo with the bubble is drawn at that region over the app; clicks pass through
   to the app below. On a Retina and an external display the halo lines up with the same region of a
   full-screen capture.
8. **Clear**: `ws.send(JSON.stringify({type:"overlay.clear",id:"h1"}))` removes it; `{type:"overlay.clear"}`
   removes all. A halo not re-sent disappears after 30 s. Closing the tab clears all halos.
9. **Pause**: toggle `Pause sensing`: halos are cleared, the console gets `status` with `paused:true`
   and no more `activity` or `app` messages until unpaused.
10. **Bad input**: `ws.send("garbage")` and `ws.send(JSON.stringify({type:"overlay.halo",id:"x",rect:{x:2,y:0,w:1,h:1}}))`
    only log a line in the companion; the connection stays open and `ping` still answers `pong`.
11. **Port in use**: start with `COMPANION_PORT=3000` while Next.js runs: the tray shows `Error: port 3000 is in use`.
12. **Packaged app**: `npm run package`, remove quarantine per README, launch the `.app`, repeat 1, 4 and 7.
