// GET /api/search?q=: the ⌘K command palette in one request. Agents, Work Maps (titles and steps), guardrails and recent
// sessions of the active workspace; withApi runs requireContext first and scopes the store to that workspace.
// q is trimmed, at most SEARCH_QUERY_MAX characters; an empty q returns the latest items of each group.
import { SEARCH_QUERY_MAX, searchPalette } from "@/lib/search/palette";
import { badRequest, withApi } from "../session/_http";

export const runtime = "nodejs";

export function GET(req: Request): Promise<Response> {
  return withApi(async ({ store }) => {
    const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
    if (q.length > SEARCH_QUERY_MAX) return badRequest("query too long");
    const [agents, digests] = await Promise.all([store.listAgents(), store.listSessionDigests()]);
    return Response.json(searchPalette(q, agents, digests));
  });
}
