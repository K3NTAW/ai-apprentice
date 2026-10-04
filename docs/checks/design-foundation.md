# design-foundation checks

Side by side: open the canvas file from `docs/design/canvas/` next to the running route, dark and light, at 1440 px and at phone width (390 px). Rollback: the change is one commit, reversible with a single `git revert`; package-lock.json was regenerated with `npm install` and is committed alongside package.json.

Automated: `src/app/tokens.test.ts` (tokens against the canvas copy, fonts, var coverage, README and sha256), `src/components/ui/ui.test.tsx`, `src/components/shell/shell.test.tsx`, `docs/design/verify-canvas.sh <source-dir>`.

## Foundation (this task)

| Canvas file | Route / component | What to compare |
| --- | --- | --- |
| `Components.dc.html` (Colour) | `src/app/globals.css` | every swatch against the token in dark; GalleryLight swatches in light; legacy aliases still colour old pages |
| `Components.dc.html` (Type) | `src/app/layout.tsx`, `.ui-t1`..`.ui-t3`, `.ui-eb`, `.ui-mono`, `.ui-qs` | Geist 64/36/24/17/14/13/12, Geist Mono tabular figures, Instrument Serif italic quote; no Google font requests in the network tab |
| `Components.dc.html` (Buttons, Keycaps) | `Button`, `Chord` | white primary, secondary, ghost, danger, icon 40 px; heights 32/40/48; keycap 26 px with 2 px bottom border |
| `Components.dc.html` (Inputs) | `Input`, `Label`, `CodeInput` | 44 px input, 12 px radius; six 44x52 code boxes with the dot after the third |
| `Components.dc.html` (Tabs, badges, score bars) | `Tabs`, `Badge`, `ScoreBar` | underline on the active tab; badge colours for confirmed, not yet confirmed, limit, exception, stop and ask, judgment call; tick at 75 %, amber below |
| `Components.dc.html` (Timeline dots) | `TimelineDot` | step 14 px blue, judgment 24 px amber, selected ring, mastered green, upcoming outline |
| `Components.dc.html` (Bubbles, halo, toast) | `SpeechBubble`, `Halo`, `Toast` | bubble corner 6 px bottom-left, expert bubble serif 21 px; halo pulse 1.8 s, off with reduced motion; toast shadow and Undo |
| `Components.dc.html` (Cards and empty state) | `Card`, `EmptyState` | 1 px border, 16 px radius, no shadow; dashed card; centred empty state with primary small button |
| `Capture.dc.html` (feed) | `FeedRow` | 64/92/1fr/auto grid, mono time, app chip, trailing badge or chord |
| `Sidebar.dc.html` | `src/components/shell/ShellHeader.tsx` | logo, nav pills (40 px, active on s2), recent list (Today/Yesterday/Earlier, live dot), workspace row, user pill 52 px; status reads 'Running in AI Apprentice' in the app, never 'paired'; no Search button (no search behaviour yet) |
| `Shell.dc.html` | `src/components/shell/AppShell.tsx` | 248 px sidebar with 1 px right line; Workspaces menu (300 px) and User menu (260 px) positions and shadow; 'Start capture' kept for owners and experts |
| `GalleryPhone.dc.html` | shell at phone width | top bar: logo, Start capture, user avatar; nav row below; recent list and switcher hidden |

## Screens for the following design tasks

| Canvas file | Route / component | What to compare |
| --- | --- | --- |
| `Main.dc.html`, `LandingLight.dc.html`, `LandingPhone.dc.html` | `/` | hero, steps, CTA copy (Sign in / Open the app) |
| `Login.dc.html`, `LoginSent.dc.html` | `/login` | browser: link form; desktop app: 6-digit code entry |
| `Gallery.dc.html`, `GalleryEmpty.dc.html`, `GalleryLight.dc.html` | `/agents` | card grid, empty state, light theme |
| `NewAgent.dc.html`, `NewAgent2.dc.html`, `NewAgent3.dc.html` | `/agents/new` | steps; step 3 shows 'Get the desktop app', no pairing |
| `Studio.dc.html`, `Avatar.dc.html` | `/agents/[id]/studio` | avatar controls and preview tile |
| `Agent.dc.html`, `AgentShortcuts.dc.html`, `AgentGuardrails.dc.html`, `AgentLearners.dc.html`, `AgentSettings.dc.html` | `/agents/[id]` | header, tabs, each tab body |
| `Capture.dc.html`, `OffRecord.dc.html` | `/capture` | console, feed, off-the-record state; Start captures directly, no picker |
| `Debrief.dc.html` | `/debrief/[id]` | score bars, teach-back |
| `WorkMap.dc.html`, `WorkMapLight.dc.html` | `/map/[id]` | timeline dots, step moment |
| `Learn.dc.html` | `/learn` | learner view |
| `Teach.dc.html`, `TeachSummary.dc.html` | `/teach` | console and summary badges |
| `Workspace.dc.html` | `/workspace` | members, invites |
| `Dock.dc.html`, `DockCollapsed.dc.html`, `FloatPanel.dc.html`, `Buddy.dc.html`, `BuddyStop.dc.html` | desktop app overlays | dock, panel, buddy states |
| `Pairing.dc.html` | none | obsolete, nothing to compare |
| `Desktop.dc.html`, `canvas.json` | none | backdrop and board index only |
