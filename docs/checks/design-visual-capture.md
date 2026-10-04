# design-visual-capture: Capture console side by side (T-0148)

Pair: `docs/design/compare/capture-app.png` (`/capture/preview`, local mode, fixture `src/lib/fixtures/capture.ts`) vs
`docs/design/compare/capture-canvas.png` (`docs/design/canvas/Capture.dc.html`), both 1440x900, dark.
Reproduce: `env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY npx next dev -p <port>`,
then headless Chrome `--window-size=1440,900 --screenshot` on `/capture/preview` and on the canvas file.

## Fixed in this task
- Light content background on /capture (`bg-slate-100` main and the white side panel with the presence dot) removed;
  the notices, presence (while running) and text-mode answer form render inside the console under the header.
- Other light leftovers (map list, dashboard hovers, map detail, Work Map view, step moment, companion card) moved to
  tokens. `src/app/theme.test.ts` fails on any light background class in `src/app` or `src/components`.
- Header, two columns, last question card, events table, questions-so-far tiles, app card and screen card per canvas.

## Remaining differences (data only)
- Sidebar: the canvas artboard renders the Sidebar import empty; the app shows the real sidebar.
- Avatar in the last question card: the canvas import renders empty; the app shows the agent's avatar.
- Event times: the app shows session offset `mm:ss`, the canvas shows wall clock `hh:mm:ss`.
- Event text: the app uses `describeEvent` wording; the canvas has hand-written lines.
- Event rows the session does not produce as feed events: the canvas "Sabine" answer row, "Pip asked / Question 3" row,
  "Judgment call" status chip and the "Off the record for 2 min 10 s" row (the app shows its own off-the-record row only
  while off the record). Redaction chip renders when the text carries a redaction marker (none in the fixture).
- Tile values (5 / 4 vs 2 / 3) come from the fixture feed.
- App card: title "Desktop app" with "Running" instead of "Companion" / "Paired", no device line, no pairing digits
  (behaviour: no pairing in the app); permission rows are the app's three (Screen Recording, Accessibility, Input
  Monitoring) instead of the canvas Microphone row.
- Screen card: no live thumbnail or display size (the app has no preview frame); a placeholder stage shows instead,
  and one Share / Stop sharing button instead of "Change screen" (no picker in the app).
- On /capture itself, task, quote answer, chips, asked-at and the next-question timer are hidden until the session
  provides them (hidden, never invented).
