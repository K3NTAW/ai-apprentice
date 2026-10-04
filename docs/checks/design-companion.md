# design-companion: companion surfaces vs the canvas (T-0136)

Canvas source: docs/design/canvas/*.dc.html (copied from the design project by the canvas-copy task; until it lands, the same files
are in the design project folder). Desktop.dc.html is the mock desktop behind the artboards, not a screen to build.

Visual aid: `node companion/scripts/canvas-values.mjs [path/to/Dock.dc.html]` prints every canvas token next to the shipped value in
companion/static/canvas.css and exits 1 on any difference.

## Map: canvas file -> shipped files -> view-model

| canvas | html | css | js | view-model |
| --- | --- | --- | --- | --- |
| Dock.dc.html | static/dock.html | static/canvas.css + static/dock.css | static/dock.js | src/dock.mts dockViewModel, dockLabels, dockBounds |
| DockCollapsed.dc.html | static/dock.html (#tab) | static/dock.css (.tab) | static/dock.js | src/dock.mts dockBounds(collapsed) |
| OffRecord.dc.html | static/dock.html (#offrec, .dock.off) | static/dock.css | static/dock.js | src/dock.mts dockLabels(offRecord) |
| Buddy.dc.html (glance) | static/overlay.html | static/overlay.css (.caption.say, .flight) | static/overlay.js, static/flightPath.js | src/overlay.mts, src/buddy.mts |
| BuddyStop.dc.html | static/overlay.html | static/overlay.css (.halo, .caption) | static/overlay.js | src/overlay.mts |
| FloatPanel.dc.html | static/panel.html | static/panel.css | static/panel.js | src/panel.mts panelViewModel, surfaceMaterial |
| (none, companion style) | static/setup.html | static/setup.css | static/setup.js | src/appUrl.mts checkAppUrl |
| Pairing.dc.html | obsolete, not built | - | - | - |

Tokens (canvas .gl block, all in canvas.css): --tx --mu --fa --ln --ln2 --s2 --s3 --bl --bls --gr --grs --rd --rds --te --tes --co --cos,
plus --glass-bg --glass-blur --glass-border --halo --tile --off-bg --font --mono. Classes: gl glass pill btn bk bw bt kc eb xs mu fa mono ic rec tile.
Light only (dark mode removed, like the canvas). Lowercase comes from the copy; no text-transform anywhere, so names, roles and feed text show as typed.
Fonts: Geist and Geist Mono variable woff2 in companion/static/fonts with OFL.txt; CSP `font-src 'self'` on dock, overlay, panel and setup; no remote font hosts.

## Side dock (Dock.dc.html -> dock.html)
- [ ] glass panel: rgba(251,251,251,.84), blur 24 px saturate 1.5, 1 px white .7 border, radius 24, 340 px wide, 12 px off the edge
- [ ] header row: "ai apprentice · training" (12 px, --mu), rec pill 26 px high with the red pulsing dot, 28 px white collapse button
- [ ] avatar tile 76 x 76, radius 22, dark gradient #2C2C31 -> #0A0A0C, avatar 64 px
- [ ] name 18/600 -0.01em, role 12 px --mu, state line with a 6 px dot in --gr ("listening · quiet while you type")
- [ ] say bubble: white pill, radius 20 20 20 6, 16/500 text, "asked at a pause" eyebrow
- [ ] "what i learned" / "this task" row, feed rows with 28 px tinted icon tiles (step blue, shortcut grey, guardrail teal), 1 px --ln dividers
- [ ] counters on --s2, radius 16, mono 17/600 numbers
- [ ] buttons: 36 px white pause, white "Off the record", black "End task"
- shipped differs: feed icons are glyphs (→ ⌘ ⚠), not the canvas SVGs; counters show asked and guardrails only (the view has no steps/shortcuts counts); no per-row time.

## Collapsed tab (DockCollapsed.dc.html -> dock.html #tab)
- [ ] 56 x 196 glass, radius 20 0 0 20 on the right edge (mirrored on the left), flush with the screen edge, no right border
- [ ] chevron in --mu, 46 px avatar tile radius 14, red rec dot, blue count badge (asked) when above 0
- shipped differs: no elapsed timer under the dot (the view has no session clock); the "at the next pause" bubble next to the tab is not built.

## Off the record (OffRecord.dc.html -> dock.html .dock.off)
- [ ] card "Off the record · nothing is captured" on #ECECEC, radius 16, eye-off icon
- [ ] dock desaturated (saturate .15), feed at .45, state "paused · off the record" in --mu, rec dot grey and still
- [ ] buttons: black "Back on the record" with the #FF6B6B dot, white "End task" (same off_record_toggle and end_task actions)
- [ ] say bubble hidden while off the record
- shipped differs: the top-centre pill and the paused cursor buddy caption are not drawn (the overlay shows the paused orb/avatar instead).

## Cursor buddy glance (Buddy.dc.html -> overlay.html)
- [ ] avatar 46 px (orb when no avatar), caption under it: glass rgba(251,251,251,.86), radius 6 20 20 20, 286 px max, 12/14 padding, 14/500 text
- [ ] dotted path while flying: #0F7FFF, 2.5 px, round caps, dash 2 9, aa-dash 1.2 s; cleared when the flight ends, when the buddy leaves this display, on pause, off the record or any draw error
- [ ] prefers-reduced-motion: no flight animation (jump), no path, no pulses
- [ ] multi-display: one overlay per display; path points clamped to that window, cursor on another display clears it

## Stop moment (BuddyStop.dc.html -> overlay.html .halo + .caption)
- [ ] halo radius 8, 2.5 px #FF7A45 ring, 9 px rgba(255,122,69,.22) spread, 40 px glow, aa-halo 1.8 s
- [ ] stop caption: glass, radius 6 22 22 22, max 340 px, 14/16 padding, 17/600 -0.01em
- shipped differs: the caption has no "pip · stop and ask" eyebrow and no Replay/Not sure buttons (the overlay is click-through; answers go by voice).

## Floating panel (FloatPanel.dc.html -> panel.html)
- [ ] 520 px wide sheet, 22 px padding, 16 px gaps, glass rgba(251,251,251,.88) (lower alpha over vibrancy/mica)
- [ ] header: 56 px tile radius 17, "AI Apprentice" 18/600, status 12 px --mu, 32 px white close button
- [ ] session and last question cards: white, radius 18, 14/16 padding; mono 17/600 counters; question 15/500, answer in --bl
- [ ] shortcuts / permissions columns with 9 px rows and --ln dividers, key chips (.kc) for the bindings
- [ ] footer: black "Open control room" with the arrow icon
- shipped differs: the mode is a label, not the Train/Teach/Off segmented control (mode is set by the session); no "Quit companion" button (quit stays in the tray); the window corner radius is the OS one, not 28.
- pairing: the pairing card stays (restyled) only for the not-yet-connected case the view-model already has; static/pairing.* is unreferenced and left in place (deleting needs approval). The "Running in AI Apprentice" status is the panel's status line (#state) and the main window.

## First-run setup (setup.html)
- [ ] #ECECEC page, centred 520 px glass sheet radius 28, eyebrow "ai apprentice · first run", 18/600 title
- [ ] pill URL field (36 px, Geist Mono) and black "Save and open" pill; error text in --rd
- [ ] CSP: style-src 'self' (no more 'unsafe-inline'), font-src 'self'

## Window material (src/panel.mts surfaceMaterial, tests in src/design.test.ts, src/panel.test.ts, src/dock.test.ts)
- panel: vibrancy on macOS, mica on Windows build >= 22621, else solid #FBFBFB (canvas glass on the canvas backdrop).
- dock: transparent window, bounds equal the glass rect, radius drawn by CSS; acrylic behind it on Windows >= 22621, solid (CSS only) on macOS and older Windows, because a native material would fill the window rect and square the 24 px corners.
- overlay: always solid (transparent, click-through); a material would frost the whole display.
- any window creation error with a material retries once with solid.

## Rollback
One commit (T-0136). `git revert <sha>` restores the previous look; nothing in the protocol, the bridge or the stored prefs changed.
