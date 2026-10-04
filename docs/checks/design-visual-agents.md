# design-visual-agents: Agents home side by side (T-0149)

Pair: `docs/design/compare/agents-app.png` (`/agents/preview`, local mode, fixture `src/lib/fixtures/agents.ts`) vs
`docs/design/compare/agents-canvas.png` (`docs/design/canvas/Gallery.dc.html`), both 1440x900, dark.
Reproduce: `env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_ANON_KEY -u SUPABASE_SERVICE_ROLE_KEY npx next dev -p <port>`,
then headless Chrome `--window-size=1440,900 --screenshot` on `/agents/preview` and on the canvas file.
`/agents/preview?empty=1` shows the empty state; `GalleryEmpty.dc.html` renders blank over file:// (nested import),
so the empty state was checked against the `empty` branch of `Gallery.dc.html` by source.

## Fixed in this task
- Input box: '+' (starts a session with the picked agent), agent picker pill (avatar, name, chevron; a native
  select underneath), mic (speech dictation where the browser supports it, else disabled) and the round Send button.
- Chip row: Train <agent> (`/capture?agent=`), Teach a new employee (`/learn?agent=`), Open a Work Map (`/map`),
  Invite an expert (`/workspace`); 40px pills with icons as drawn.
- Section header: 'Agents · Each one learns from one expert', search 'Search agents or experts' (filters by name,
  role or expert) and the white '+ New agent' button; segmented filter tabs All / Ready to teach / Training with counts.
- Cards: stage tile with status badge (Ready to teach = at least one confirmed Work Map, else Training) and
  'Trained <ISO date>', name, role, expert initials dot with 'learns from <expert>', four stats with mono numbers;
  dashed 'New agent' card with the round plus.
- Empty state: avatar, title, text, 'Create your first agent' and 'Install the companion', the three step tiles.

## Remaining differences (data only)
- Sidebar: the canvas artboard renders the Sidebar import empty; the app shows the real sidebar.
- Avatars (cards and the picker pill): the canvas imports render empty; the app shows the agents' avatars.
- Card order: the app sorts by name (Bolt, Juno, Nova, Otto, Pip), the canvas lists Pip first; the picker and the
  Train chip default to the first card, so they read 'Bolt' instead of 'Pip'.
- Card text, status, last trained and stat values: the canvas shows `{{a.*}}` placeholders; the app shows fixture
  values. Shortcuts show 'none yet' (agentStats reports null until chords are recorded).
- Status for a training agent reads 'Training' (no live-session signal), the canvas sample data has 'Training now'.
- Greeting uses the signed-in email's first name; the preview passes 'Sabine'.
- Empty state (behaviour): no Train chip without agents, and the 'Create an agent first' note under the box stays.
