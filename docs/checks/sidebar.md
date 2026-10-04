# Manual checks: sidebar (Sidebar.dc.html, Shell.dc.html)

Run against `http://localhost:3000` signed in to a workspace with at least one agent, one confirmed Work Map,
one running capture and one teach session. Automated: `npx vitest run src/components/shell src/app/api/search`.

1. **Search and ⌘K**: the search field at the top shows `⌘K` on macOS and `Ctrl K` on Windows. ⌘K (Ctrl+K) on any
   app page opens the palette; typing searches agents, Work Map titles and step titles, guardrails and recent
   sessions of the active workspace. DevTools Network shows one `/api/search` request per typing pause.
   Actions: New agent, Train <agent>, Teach a new employee, Workspace. ArrowUp/ArrowDown move, Enter opens, Esc closes.
2. **Nav**: Agents, Learn, Workspace, Get the desktop app. Inside the desktop app the last item is hidden.
3. **Recent sessions**: grouped Today / Yesterday / Earlier in Europe/Zurich. Titles: `Training Pip · <topic>`
   (running capture, red live dot and elapsed time), `Work Map · <task>`, `Debrief · <topic>`,
   `<learner> learns <task>`, `<agent> · <topic>`. Second line: `live · 12 min`, `x of y mastered` (local mode,
   where teach progress is stored), `confirmed`, `<agent> · 14:05`, or the ISO date for Earlier. Each opens its page.
4. **Bottom cards**: workspace row `<initials> <name> · <city>` with an up/down chevron; below it the user card
   `<initials> <full name>` with a chevron. No green dot and no status line under the name (no `browser`, no
   `desktop app connected`). Without a display name the card shows the address local part, capitalised.
5. **Collapse**: the toggle next to the logo shrinks the sidebar to a 72 px icon rail; reload keeps it for this
   viewer. With localStorage blocked the toggle still works and the sidebar opens expanded on reload.
6. **Workspace menu**: click the workspace row (or Tab to it and press Enter). The menu lists your workspaces with
   the role badge and a check on the active one; ArrowUp/ArrowDown move, Esc closes and returns focus to the row,
   a click outside closes. Choosing another workspace reloads into it. `Workspace settings` opens /workspace.
7. **Create workspace**: from the menu. An empty name shows `Enter a workspace name.` and sends nothing; a name
   (1..60 chars) and an optional city create the workspace, make you its owner and reload into it. The 11th owned
   workspace is refused. Before migration `20261004020000_workspace_create` is applied the dialog shows
   `Workspace creation is not available yet.` (POST /api/workspace answers 503).
8. **User menu**: Account shows the address; `Change display name` saves inline and the card shows the new name
   (also after a reload). Theme: Dark, Light, System (follows the OS setting), remembered on reload. Sign out
   returns to the sign-in page.

Workspace city: shown after the name once the migration is applied; a name that already ends in `· <city>` is not
repeated.
