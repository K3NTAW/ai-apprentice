// Local preview routes (design compare) exist only in local mode: in supabase mode they call notFound() (404).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useParams: () => ({}),
  usePathname: () => "/",
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

const mode = vi.hoisted(() => ({ value: "supabase" as string }));
vi.mock("@/lib/supabase/env", async (orig) => ({ ...(await orig<object>()), appMode: () => mode.value }));

import NewAgentPreview from "./agents/new/preview/page";
import DebriefPreview from "./debrief/preview/page";
import TeachPreviewPage from "./teach/preview/page";

const sp = (o: Record<string, string> = {}) => ({ searchParams: Promise.resolve(o) });

describe("preview routes", () => {
  beforeEach(() => {
    mode.value = "supabase";
  });
  afterEach(() => {
    mode.value = "supabase";
  });

  it("404 in supabase mode", async () => {
    await expect(NewAgentPreview(sp({ step: "2" }))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(DebriefPreview(sp())).rejects.toThrow("NEXT_NOT_FOUND");
    expect(() => TeachPreviewPage()).toThrow("NEXT_NOT_FOUND");
  });

  it("debrief in progress (local): follow-up question, live answer, understanding per step", async () => {
    mode.value = "local";
    const html = renderToStaticMarkup(await DebriefPreview(sp()));
    expect(html).toContain('data-testid="debrief-question"');
    expect(html).toContain('data-testid="live-answer"');
    expect(html).toContain("Sabine · answering");
    expect(html).toContain("Second approval, Czech subsidiary");
  });

  it("debrief teach-back (local)", async () => {
    mode.value = "local";
    const html = renderToStaticMarkup(await DebriefPreview(sp({ state: "teach_back" })));
    expect(html).toContain("Here is how I understood it.");
  });

  it("teach live (local): step progress, watching chips, transcript, replay card", () => {
    mode.value = "local";
    const html = renderToStaticMarkup(TeachPreviewPage());
    for (const t of ["Current step · 4 of 7", "Pip is watching for", "Equipment over €5,000 → capex 0400", "Krämer invoice", 'data-testid="intervention"']) expect(html).toContain(t);
  });
});
