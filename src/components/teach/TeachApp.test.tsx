import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TeachApp from "./TeachApp";

describe("Teach placeholder", () => {
  it("renders the rebuild notice", () => {
    expect(renderToStaticMarkup(<TeachApp sessionId={null} localMode />)).toContain("Teach is being rebuilt for real apps");
  });
});
