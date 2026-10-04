# design-control-room-a: side-by-side checks (T-0143)

Canvas source: `docs/design/canvas/` (byte copy, see `docs/design/canvas.sha256`). Open the canvas file next to the
route and compare. Light variants: the same route with `data-theme="light"` on `<html>` (or the OS light scheme).
Phone variants: the same route at 390 px wide. No separate routes for either.

Verified by `src/app/agents/home.test.tsx` (this table lists every canvas file in scope) and the render tests named
per section.

## (a) Landing and login

| canvas | route | component | compare |
| --- | --- | --- | --- |
| `Main.dc.html` | `/` (dark) | `src/components/landing/Landing.tsx` | header mark + nav (How it works, The Apprentice Test, Trust, Sign in); hero badge, headline, 19 px lead, two CTAs, 'Runs next to Outlook...' line; invoice card with highlighted 4517 row, Pip bubble, expert quote, guardrail badge; Train, Map, Teach cards; five Apprentice Test rows; trust card; footer |
| `LandingLight.dc.html` | `/` with `data-theme="light"` | `Landing.tsx` (tokens from `globals.css` light rule) | same as Main with light tokens: bg, s1, ln, mu, accent |
| `LandingPhone.dc.html` | `/` at 390 px | `Landing.tsx` (auto-fit grid wraps to one column) | hero stacks above the invoice card; cards one per row; nav wraps |
| `Login.dc.html` | `/login` | `src/app/login/page.tsx` (frame), `LoginForm.tsx` (idle) | brand + 'Back to the site'; 440 px card, 40/36 padding; 'Sign in', 'We email you a one-time link...', 'Work email', 48 px full-width primary button; 'New here?' note. App: 'Email me a code'. Browser: 'Email me a sign-in link' |
| `LoginSent.dc.html` | `/login`, sent state | `LoginForm.tsx` (state sent) | 'Check your email', address in tx colour, expiry line, 'Subject to look for' box (browser only), 'Use a different email', spam note. App: 6-digit code entry; browser: link plus optional code |
| `Pairing.dc.html` | none | none | **obsolete**: no pairing anywhere. Step 3 shows 'Running in AI Apprentice' instead |

## (b) Agents home and gallery

| canvas | route | component | compare |
| --- | --- | --- | --- |
| `Gallery.dc.html` | `/agents` | `src/components/agents/AgentsHome.tsx`, `AgentGallery.tsx` | centred greeting (t1, weight 500); 760 px input box, radius 28, `--cmp` bg, placeholder 'Ask how something is done, or start a session'; agent picker + 'Start a session'; results (step, guardrail badges) under the box; 'Agents' + 'Each one learns from one expert'; cards: 176 px stage, 124 px avatar, name t2, role 15 px, expert line, 4-column stats; dashed 'New agent' card min 380 px |
| `GalleryEmpty.dc.html` | `/agents` with no agents | `AgentGallery.tsx` (`GalleryEmpty`) | card 64/32 padding; 'No agents yet'; 'Start with the person...'; 'Create your first agent' (owners and experts only); three step tiles on `--s2` |
| `GalleryLight.dc.html` | `/agents` with `data-theme="light"` | same | light tokens incl. `--stage`, `--cmp` |
| `GalleryPhone.dc.html` | `/agents` at 390 px | same | one card per row; input box full width |

## (c) New agent, studio, workspace

| canvas | route | component | compare |
| --- | --- | --- | --- |
| `NewAgent.dc.html` | `/agents/new` | `src/app/agents/new/page.tsx`, `src/components/agents/NewAgentFlow.tsx` (step 1) | 'Agents /' crumb, 'New agent' t1; stepper Details, Avatar, Install and train; form card 'Who is it, and who does it learn from?', Agent name, Role it will fill, Expert it learns from + note; Cancel / Continue; card preview with 'Not trained yet' |
| `NewAgent2.dc.html` | `/agents/new` after Continue | `NewAgentFlow.tsx` (step 2) + `AgentAvatarStudio` | 'Give {name} a face', learners note, shape and face chips, body colour and accent |
| `NewAgent3.dc.html` | `/agents/new` after Continue | `NewAgentFlow.tsx` (step 3) | 'Install and train'; 'Running in AI Apprentice' status replaces install + pairing; 'Start training' opens `/capture?agent=<id>` |
| `Studio.dc.html` | `/agents/[id]/studio` | `src/app/agents/[id]/studio/page.tsx`, `src/components/avatar/AvatarStudio.tsx` | 'Avatar studio' t1, save scope line; stage preview, animation chips; Shape, Face, Body colour, Accent; Randomize, Save, Export SVG, Export PNG |
| `Workspace.dc.html` | `/workspace` | `src/app/workspace/page.tsx`, `WorkspaceClient.tsx` | 'Workspace' eyebrow, workspace name t1; Members card with 'Owners manage members. Experts train agents. Learners learn.'; 'Invite by email'; pending invites |

## Not yet 1:1 (left for a follow-up)

- Landing: the canvas avatars (hero, Train/Teach cards) and the Map timeline dots are not drawn; text stands in.
- Gallery: filter tabs (All, Ready to teach, Training), status badge and last-active time per card, quick chips under the box.
- New agent step 2: canvas tile grid with avatar thumbnails (the studio chips are used instead).
- Studio: palette names, hex fields per colour, 'At real size' previews.
- Workspace: the member table columns (Name, Role, Agents, Last active).
