import { describe, expect, it } from "vitest";
import { POST } from "@/app/api/vision/route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/vision", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/vision", () => {
  it.each(["a/b", "..", "../etc", "x..y"])("rejects session_id %s with 400", async (session_id) => {
    const res = await post({ session_id, t: 1, frame: "AAAA" });
    expect(res.status).toBe(400);
  });
});
