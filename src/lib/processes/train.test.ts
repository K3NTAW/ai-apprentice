import { describe, expect, it } from "vitest";
import { intentChoice, intentQuery, parseTrainIntent, trainHref } from "./train";

describe("training entry points (slice d)", () => {
  it("'Add to this process' and 'Retrain from scratch' open Capture with the process and the mode", () => {
    expect(trainHref("pip", "p-1", "extend")).toBe("/capture?agent=pip&process=p-1&mode=extend");
    expect(trainHref("pip", "p-1", "replace")).toBe("/capture?agent=pip&process=p-1&mode=replace");
  });

  it("parses ?process&mode, rejecting bad ids and modes", () => {
    expect(parseTrainIntent("p-1", "extend")).toEqual({ processId: "p-1", mode: "extend" });
    expect(parseTrainIntent("p-1", "replace")).toEqual({ processId: "p-1", mode: "replace" });
    expect(parseTrainIntent("p-1", "merge")).toBeNull();
    expect(parseTrainIntent("p/1", "extend")).toBeNull();
    expect(parseTrainIntent(undefined, "extend")).toBeNull();
    expect(parseTrainIntent(["p-1"], "extend")).toBeNull();
  });

  it("Capture passes the intent to the debrief, which adds or replaces without asking", () => {
    expect(intentQuery({ processId: "p-1", mode: "extend" })).toBe("?process=p-1&mode=extend");
    expect(intentQuery(null)).toBe("");
    expect(intentChoice("extend")).toBe("add");
    expect(intentChoice("replace")).toBe("replace");
  });
});
