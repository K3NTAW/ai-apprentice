import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import ProcessActions from "./ProcessActions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

describe("Processes tab row actions (slice d)", () => {
  it("owner: edit, both training entry points, archive and delete", () => {
    const html = renderToStaticMarkup(<ProcessActions agentId="pip" processId="p-1" role="owner" />);
    expect(html).toContain('href="/processes/p-1"');
    expect(html).toContain('href="/capture?agent=pip&amp;process=p-1&amp;mode=extend"');
    expect(html).toContain('href="/capture?agent=pip&amp;process=p-1&amp;mode=replace"');
    expect(html).toContain("Archive");
    expect(html).toContain("Delete");
  });

  it("expert: no archive, no delete; learner: details only", () => {
    const expert = renderToStaticMarkup(<ProcessActions agentId="pip" processId="p-1" role="expert" />);
    expect(expert).toContain("Retrain from scratch");
    expect(expert).not.toContain("Archive");
    expect(expert).not.toContain("Delete");
    const learner = renderToStaticMarkup(<ProcessActions agentId="pip" processId="p-1" role="learner" />);
    expect(learner).toContain("Details");
    expect(learner).not.toContain("/capture");
  });
});
