import { afterEach, describe, expect, it, vi } from "vitest";
import { redactText, redactTextAsync } from "./index";

describe("redactText", () => {
  it("replaces IBAN, email and phone with Presidio placeholders", () => {
    const { text, entities } = redactText(
      "Pay to CH93 0076 2011 6238 5295 7, write to anna.keller@example.ch or call +41 44 123 45 67 or 044 987 65 43.",
    );
    expect(text).toBe("Pay to <IBAN_CODE>, write to <EMAIL_ADDRESS> or call <PHONE_NUMBER> or <PHONE_NUMBER>.");
    expect(entities.map((e) => e.type)).toEqual(["IBAN_CODE", "EMAIL_ADDRESS", "PHONE_NUMBER", "PHONE_NUMBER"]);
  });

  it("handles German IBAN without spaces and credit cards", () => {
    expect(redactText("IBAN DE89370400440532013000 card 4111 1111 1111 1111").text).toBe(
      "IBAN <IBAN_CODE> card <CREDIT_CARD>",
    );
  });

  it("replaces titled and contact names", () => {
    expect(redactText("I called Frau Meier and Dr. Hans Huber.").text).toBe(
      "I called Frau <PERSON> and Dr. <PERSON>.",
    );
    expect(redactText("Contact: Peter Brunner, Ansprechpartner: Lena Vogt").text).toBe(
      "Contact: <PERSON>, Ansprechpartner: <PERSON>",
    );
  });

  it("replaces known names, full and surname only", () => {
    const opts = { knownNames: ["Markus Weber"] };
    expect(redactText("Markus Weber called it. Weber again.", opts).text).toBe("<PERSON> called it. <PERSON> again.");
  });

  it("keeps invoice numbers, cost centers, amounts, dates and keepNames", () => {
    const input =
      "Sabine: invoice 4471 goes to cost center 4711, not 0400. EUR 7,200.00 and 7,200 and EUR 5,000 due 2026-12-03 or 03.12.2026.";
    const { text, entities } = redactText(input, { keepNames: ["Sabine"], knownNames: ["Sabine Roth"] });
    expect(text).toBe(input);
    expect(entities).toEqual([]);
    expect(redactText("Frau Sabine said so", { keepNames: ["Sabine"] }).text).toBe("Frau Sabine said so");
  });

  it("longest match wins on overlap", () => {
    const { entities } = redactText("CH93 0076 2011 6238 5295 7");
    expect(entities).toEqual([{ type: "IBAN_CODE", start: 0, end: 26 }]);
  });
});

describe("redactTextAsync", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("wraps redactText without PRESIDIO_URL", async () => {
    vi.stubEnv("PRESIDIO_URL", "");
    expect((await redactTextAsync("Frau Meier")).text).toBe("Frau <PERSON>");
  });

  it("falls back to local recognizers when Presidio fails", async () => {
    vi.stubEnv("PRESIDIO_URL", "http://127.0.0.1:1");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("down")));
    expect((await redactTextAsync("Frau Meier")).text).toBe("Frau <PERSON>");
  });
});
