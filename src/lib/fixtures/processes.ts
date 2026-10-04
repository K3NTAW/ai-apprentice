// Preview fixture for the process page (/processes/preview): Pip's invoice Work Map as a process at version 2.
import type { Process, ProcessVersion } from "@/lib/store/types";
import { pipWorkMap } from "./preview";

export const previewProcess: Process = {
  id: "pip-process",
  workspace_id: "preview",
  agent_id: "pip",
  title: pipWorkMap.task,
  workmap: pipWorkMap,
  version: 2,
  confirmed: pipWorkMap.confirmed_by_expert,
  archived_at: null,
  created_by: null,
  created_at: "2026-10-02T08:00:00.000Z",
  updated_at: "2026-10-03T09:30:00.000Z",
};

export const previewProcessVersions: ProcessVersion[] = [
  { id: "pip-v2", process_id: previewProcess.id, version: 2, workmap: pipWorkMap, source_session_id: null, change_kind: "edited", changed_by: null, created_at: previewProcess.updated_at },
  { id: "pip-v1", process_id: previewProcess.id, version: 1, workmap: pipWorkMap, source_session_id: "pip-1", change_kind: "trained", changed_by: null, created_at: previewProcess.created_at },
];
