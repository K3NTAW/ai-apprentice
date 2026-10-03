import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MapLearners } from "./MapDetail";

describe("MapLearners", () => {
  it("lists who practised, when and the result; guides when empty", () => {
    const html = renderToStaticMarkup(
      <MapLearners
        rows={[
          {
            workmapSessionId: "c1",
            task: "Approve invoices",
            learner: "anna@example.com",
            date: "2026-10-03 23:40",
            mastered: ["Check supplier"],
            practiceNext: [],
            interventions: 0,
            finished: true,
          },
        ]}
      />,
    );
    expect(html).toContain(">Learners</h2>");
    expect(html).toContain("anna@example.com");
    expect(html).toContain("2026-10-03 23:40");
    expect(html).toContain("Mastered: Check supplier");
    expect(renderToStaticMarkup(<MapLearners rows={[]} />)).toContain("Nobody has practised this Work Map yet");
  });
});
