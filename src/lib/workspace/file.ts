// Local mode workspace name and city: <DATA_DIR>/workspace.json. Missing or corrupt reads as the default 'local'.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { dataDir } from "@/lib/store/file";

export type LocalWorkspace = { name: string; city: string | null };

export const LOCAL_WORKSPACE_ID = "local";
const DEFAULT: LocalWorkspace = { name: "local", city: null };

export const workspaceFile = () => path.join(dataDir(), "workspace.json");

export async function readLocalWorkspace(): Promise<LocalWorkspace> {
  try {
    const raw = JSON.parse(await readFile(workspaceFile(), "utf8")) as { name?: unknown; city?: unknown };
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : DEFAULT.name;
    const city = typeof raw.city === "string" && raw.city ? raw.city : null;
    return { name, city };
  } catch {
    return { ...DEFAULT };
  }
}

/** Sets the name; the city is replaced when given (null clears it) and kept when undefined, like PATCH /api/workspace. */
export async function renameLocalWorkspace(input: { name: string; city?: string | null }): Promise<LocalWorkspace> {
  const current = await readLocalWorkspace();
  const next: LocalWorkspace = { name: input.name, city: input.city === undefined ? current.city : input.city };
  const file = workspaceFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(next, null, 1));
  await rename(tmp, file);
  return next;
}
