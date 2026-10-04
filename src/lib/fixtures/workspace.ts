// Workspace fixture (design compare, docs/design/compare/workspace-*.png): the owner view of Workspace.dc.html.
import type { WorkspaceView } from "@/lib/auth/context";

export const previewWorkspace: WorkspaceView = {
  workspaceId: "local",
  workspaceName: "Finance Ops · Zug",
  email: "sabine.keller@example.com",
  role: "owner",
  isOwner: true,
  members: [
    { userId: "sabine", label: "sabine.keller@example.com", role: "owner", isSelf: true },
    { userId: "marco", label: "marco.bianchi@example.com", role: "expert", isSelf: false },
    { userId: "urs", label: "urs.gerber@example.com", role: "expert", isSelf: false },
    { userId: "lena", label: "lena.graf@example.com", role: "learner", isSelf: false },
    { userId: "tim", label: "tim.huber@example.com", role: "learner", isSelf: false },
  ],
  truncated: false,
  invites: [
    { id: "i-1", email: "reto.frei@example.com", role: "expert", createdAt: "2026-10-01T09:00:00Z" },
    { id: "i-2", email: "jan.kral@example.com", role: "learner", createdAt: "2026-09-30T09:00:00Z" },
  ],
  memberships: [],
};
