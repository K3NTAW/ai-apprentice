// Every page the interaction guard renders (local mode, fixture data). Private folder: not a route.
import type { ReactElement } from "react";
import AppShell from "@/components/shell/AppShell";
import ShellHeader, { type ShellUser } from "@/components/shell/ShellHeader";
import { groupRecent } from "@/components/shell/recent";
import Home from "../page";
import LoginPage from "../login/page";
import LoginPreviewPage from "../login/preview/page";
import ConfirmedPage from "../auth/confirmed/page";
import ResetPage from "../auth/reset/page";
import AgentsPage from "../agents/page";
import AgentsPreviewPage from "../agents/preview/page";
import AgentPage from "../agents/[id]/page";
import AgentPreviewPage from "../agents/preview/[id]/page";
import NewAgentPage from "../agents/new/page";
import NewAgentPreviewPage from "../agents/new/preview/page";
import AvatarStudioPage from "../agents/[id]/studio/page";
import MapListPage from "../map/page";
import MapPage from "../map/[id]/page";
import MapPreviewPage from "../map/preview/page";
import DebriefPage from "../debrief/[id]/page";
import DebriefPreviewPage from "../debrief/preview/page";
import LearnPage from "../learn/page";
import LearnPreviewPage from "../learn/preview/page";
import CapturePage from "../capture/page";
import CapturePreviewPage from "../capture/preview/page";
import TeachPage from "../teach/page";
import TeachPreviewPage from "../teach/preview/page";
import WorkspacePage from "../workspace/page";
import WorkspacePreviewPage from "../workspace/preview/page";

const sp = <T extends object>(o: T = {} as T) => ({ searchParams: Promise.resolve(o) });
const params = (id: string) => Promise.resolve({ id });
// The shell with a signed-in owner of two workspaces and recent sessions of each kind, so the user menu,
// the workspace switcher and the recent list are audited too (the local store is empty in tests).
const NOW = new Date("2026-10-04T10:00:00Z");
const counts = { events: 1, transcript: 0, qa: 0 };
const recent = groupRecent(
  [
    { id: "s-live", kind: "capture", started_at: "2026-10-04T09:00:00Z", counts, has_workmap: false, expert: "Sabine" },
    { id: "s-map", kind: "capture", started_at: "2026-10-03T09:00:00Z", ended_at: "2026-10-03T09:30:00Z", counts, has_workmap: true },
    { id: "s-teach", kind: "teach", started_at: "2026-10-01T09:00:00Z", ended_at: "2026-10-01T09:30:00Z", counts, has_workmap: false },
  ],
  NOW,
);
export const auditUser: ShellUser = {
  mode: "supabase",
  workspaceName: "Finance",
  email: "owner@example.com",
  role: "owner",
  workspaceId: "w1",
  memberships: [
    { workspaceId: "w1", name: "Finance", role: "owner" },
    { workspaceId: "w2", name: "Ops", role: "learner" },
  ],
};

const shell = async (el: ReactElement) => <AppShell>{el}</AppShell>;

export const SHELL_ROUTES = ["/shell", "/shell (signed in)"] as const;

export const ROUTES: Array<{ route: string; render: () => Promise<ReactElement> }> = [
  { route: "/", render: async () => <Home /> },
  { route: "/login", render: async () => <LoginPage {...sp()} /> },
  { route: "/login/preview", render: async () => <LoginPreviewPage /> },
  { route: "/auth/confirmed", render: async () => <ConfirmedPage /> },
  { route: "/auth/reset", render: async () => <ResetPage /> },
  { route: "/shell", render: () => shell(<div />) },
  { route: "/shell (signed in)", render: async () => <ShellHeader user={auditUser} recent={{ kind: "ok", groups: recent }} /> },
  { route: "/agents", render: async () => <AgentsPage /> },
  { route: "/agents/preview", render: async () => <AgentsPreviewPage {...sp()} /> },
  { route: "/agents/preview?empty=1", render: async () => <AgentsPreviewPage {...sp({ empty: "1" })} /> },
  { route: "/agents/[id]", render: async () => <AgentPage params={params("pip")} {...sp()} /> },
  ...(["processes", "shortcuts", "guardrails", "learners", "settings"] as const).map((tab) => ({
    route: `/agents/preview/[id]?tab=${tab}`,
    render: async () => <AgentPreviewPage params={params("pip")} {...sp({ tab })} />,
  })),
  { route: "/agents/new", render: async () => <NewAgentPage /> },
  { route: "/agents/new/preview", render: async () => <NewAgentPreviewPage {...sp()} /> },
  { route: "/agents/new/preview?step=2", render: async () => <NewAgentPreviewPage {...sp({ step: "2" })} /> },
  { route: "/agents/[id]/studio", render: async () => <AvatarStudioPage params={params("pip")} /> },
  { route: "/map", render: () => shell(<MapListPage />) },
  { route: "/map/[id]", render: () => shell(<MapPage params={params("pip-1")} />) },
  { route: "/map/preview", render: () => shell(<MapPreviewPage />) },
  { route: "/debrief/[id]", render: () => shell(<DebriefPage />) },
  { route: "/debrief/preview", render: () => shell(<DebriefPreviewPage {...sp()} />) },
  { route: "/debrief/preview?state=teach_back", render: () => shell(<DebriefPreviewPage {...sp({ state: "teach_back" })} />) },
  { route: "/learn", render: async () => <LearnPage {...sp()} /> },
  { route: "/learn/preview", render: async () => <LearnPreviewPage /> },
  { route: "/capture", render: () => shell(<CapturePage {...sp()} />) },
  { route: "/capture/preview", render: () => shell(<CapturePreviewPage />) },
  { route: "/teach", render: () => shell(<TeachPage {...sp()} />) },
  { route: "/teach/preview", render: () => shell(<TeachPreviewPage />) },
  { route: "/workspace", render: async () => <WorkspacePage /> },
  { route: "/workspace/preview", render: async () => <WorkspacePreviewPage /> },
];
