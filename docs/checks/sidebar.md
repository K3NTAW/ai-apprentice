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
4. **Bottom cards**: workspace card with initials, name and switcher; user card with initials, address and
   `desktop app connected` in the app, `browser` otherwise. Never `companion paired`.
5. **Collapse**: the toggle next to the logo shrinks the sidebar to a 72 px icon rail; reload keeps it for this
   viewer. With localStorage blocked the toggle still works and the sidebar opens expanded on reload.

Workspace city: the workspace has no city field; a name such as `Finance Ops · Zug` shows as written.
