import { describe, expect, it } from "vitest";
import { browser, makeApp } from "./helpers";

describe("claim links cannot be guessed at speed", () => {
  it("a client trying many different tokens runs into the limit, because the limit is per route group and not per URL", async () => {
    const { app } = await makeApp({ env: { RATE_LIMIT_PER_MIN: "5" } });
    const b = browser(app);
    const codes: number[] = [];
    for (let i = 0; i < 9; i++) codes.push((await b.get(`/api/claims/${"A".repeat(21)}${i}`)).status);
    expect(codes.slice(0, 5).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(5)).toEqual([429, 429, 429, 429]);
  });

  it("an unknown token says nothing about which tokens exist", async () => {
    const { app } = await makeApp();
    const r = await browser(app).get(`/api/claims/${"B".repeat(22)}`);
    expect(r.status).toBe(404);
    expect(r.text).not.toContain("BBBBBBBBBB"); // never repeats the token it was sent
  });
});
