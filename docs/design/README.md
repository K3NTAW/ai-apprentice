# Design reference

`canvas/` is a byte-identical copy of the design canvas source (https://claude.ai/artifact/De8sekogpysfN4cBZfseGr), one self-contained HTML file per artboard plus `canvas.json` (board titles, sizes, positions). It is the visual contract: layout, spacing, sizes, radii, borders, colours, type, icons, copy, states and motion come from these files.

Where the canvas conflicts with shipped behaviour, behaviour wins and only the look follows the canvas: no pairing (show 'Running in AI Apprentice'), no share-screen picker (Start captures directly), desktop login by 6-digit code (link in the browser).

- Tokens: dark from `Components.dc.html` `.aa`, light from `Gallery.dc.html` `.lt` (rendered by `GalleryLight.dc.html`). Implemented in `src/app/globals.css`, checked by `src/app/tokens.test.ts`, which reads the values out of these files.
- Checksums: `canvas.sha256` lists the sha256 of every file. `verify-canvas.sh [source-dir]` checks the copy against the manifest and, given the source folder, the manifest against the source.

| File | Board | Route / component |
| --- | --- | --- |
| `Agent.dc.html` | 7 Agent · Processes | `/agents/[id]` · `src/components/agents/AgentDetail.tsx` |
| `AgentGuardrails.dc.html` | 7 Agent · Guardrails | `/agents/[id]` guardrails tab · `AgentDetail.tsx` |
| `AgentLearners.dc.html` | 7 Agent · Learners | `/agents/[id]` learners tab · `AgentDetail.tsx` |
| `AgentSettings.dc.html` | 7 Agent · Settings | `/agents/[id]` settings tab · `src/components/agents/AgentSettings.tsx` |
| `AgentShortcuts.dc.html` | 7 Agent · Shortcuts | `/agents/[id]` shortcuts tab · `AgentDetail.tsx` |
| `Avatar.dc.html` | Clay avatar (tweakable) | `src/components/agents/AgentAvatar.tsx` |
| `Buddy.dc.html` | 15 Cursor buddy · glance | desktop app `companion/src/buddy.mts` |
| `BuddyStop.dc.html` | 15 Cursor buddy · stop | desktop app `companion/src/buddy.mts` (stop and ask state) |
| `Capture.dc.html` | 8 Capture console | `/capture` · `src/components/capture/CaptureConsole.tsx` |
| `Components.dc.html` | 19 Component sheet | `src/components/ui/index.tsx`, tokens in `src/app/globals.css` |
| `Debrief.dc.html` | 9 Debrief and teach-back | `/debrief/[id]` · `src/components/debrief/DebriefApp.tsx` |
| `Desktop.dc.html` | Mock desktop background | backdrop for the desktop artboards only, no route |
| `Dock.dc.html` | 14 Side dock · training | desktop app `companion/src/dock.mts` |
| `DockCollapsed.dc.html` | 14 Side dock · collapsed 56 px tab | desktop app `companion/src/dock.mts` (collapsed) |
| `FloatPanel.dc.html` | 16 Floating panel ⌥⇧A | desktop app `companion/src/panel.mts` |
| `Gallery.dc.html` | 4 Agents gallery · dark | `/agents` · `src/components/agents/AgentGallery.tsx` |
| `GalleryEmpty.dc.html` | 4 Agents gallery · empty | `/agents` empty state · `AgentGallery.tsx` |
| `GalleryLight.dc.html` | 4 Agents gallery · light | `/agents` light theme; source of the light tokens |
| `GalleryPhone.dc.html` | 4 Agents gallery · phone | `/agents` at phone width, shell top bar |
| `LandingLight.dc.html` | 1 Landing · light | `/` light theme · `src/components/landing/Landing.tsx` |
| `LandingPhone.dc.html` | 1 Landing · phone | `/` at phone width · `Landing.tsx` |
| `Learn.dc.html` | 11 Learn | `/learn` · `src/components/agents/LearnView.tsx` |
| `Login.dc.html` | 2 Login · magic link | `/login` · `src/app/login/LoginForm.tsx` (code entry in the app, link in the browser) |
| `LoginSent.dc.html` | 2 Login · check your email | `/login` sent state · `LoginForm.tsx` (6-digit code input in the app) |
| `Main.dc.html` | 1 Landing · dark | `/` · `Landing.tsx` |
| `NewAgent.dc.html` | 5 New agent · 1 Details | `/agents/new` · `src/components/agents/NewAgentFlow.tsx` |
| `NewAgent2.dc.html` | 5 New agent · 2 Avatar | `/agents/new` step 2 · `NewAgentFlow.tsx` |
| `NewAgent3.dc.html` | 5 New agent · 3 Install and train | `/agents/new` step 3 · `NewAgentFlow.tsx` ('Get the desktop app', no pairing) |
| `OffRecord.dc.html` | 18 Off the record | `/capture` off-the-record state · `CaptureConsole.tsx` |
| `Pairing.dc.html` | 17 Pairing window | **obsolete**: no pairing; the shell shows 'Running in AI Apprentice' instead |
| `Shell.dc.html` | 3 App shell | `src/components/shell/AppShell.tsx` (workspace and user menus) |
| `Sidebar.dc.html` | Sidebar | `src/components/shell/ShellHeader.tsx` |
| `Studio.dc.html` | 6 Avatar studio | `/agents/[id]/studio` · `src/components/avatar/AgentAvatarStudio.tsx` |
| `Teach.dc.html` | 12 Teach console | `/teach` · `src/components/teach/TeachConsole.tsx` |
| `TeachSummary.dc.html` | 12 Teach · Mastered / Practice next | `/teach` summary · `src/components/teach/TeachApp.tsx` |
| `WorkMap.dc.html` | 10 Work Map · dark | `/map/[id]` · `src/components/workmap/WorkMapView.tsx` |
| `WorkMapLight.dc.html` | 10 Work Map · light | `/map/[id]` light theme · `WorkMapView.tsx` |
| `Workspace.dc.html` | 13 Workspace | `/workspace` · `src/app/workspace/WorkspaceClient.tsx` |
| `canvas.json` | board index | none: titles, sizes and positions of every board |
