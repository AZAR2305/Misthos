import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { nodeCliRunner } from "../src/wallets/circleCli.js";

describe("per-agent Circle login folders", () => {
  // A stand-in CLI entry that just prints the environment it was started with, to prove the runner passes it through.
  const dir = mkdtempSync(join(tmpdir(), "misthos-cli-"));
  const entry = join(dir, "print-env.cjs");
  writeFileSync(entry, "process.stdout.write(JSON.stringify({ home: process.env.CIRCLE_CLI_HOME ?? null, args: process.argv.slice(2) }));");

  it("sets CIRCLE_CLI_HOME for the supplier and the buyer independently", async () => {
    const supplier = await nodeCliRunner(entry, 20_000, { CIRCLE_CLI_HOME: "/tmp/circle-supplier" })(["wallet", "status"]);
    const buyer = await nodeCliRunner(entry, 20_000, { CIRCLE_CLI_HOME: "/tmp/circle-buyer" })(["wallet", "status"]);
    expect(JSON.parse(supplier.stdout)).toEqual({ home: "/tmp/circle-supplier", args: ["wallet", "status"] });
    expect(JSON.parse(buyer.stdout).home).toBe("/tmp/circle-buyer");
  });

  it("passes JSON arguments through untouched (no shell quoting)", async () => {
    const json = '{"types":{"A":[{"name":"x","type":"uint256"}]},"message":{"x":"1"}}';
    const r = await nodeCliRunner(entry, 20_000)(["wallet", "sign", "typed-data", json]);
    expect(JSON.parse(r.stdout).args[3]).toBe(json);
  });

  it("reports a missing CLI entry as a failure, not a crash", async () => {
    const r = await nodeCliRunner(join(dir, "does-not-exist.cjs"), 20_000)(["x"]);
    expect(r.exitCode).not.toBe(0);
  });
});

import { idempotencyUuid } from "../src/wallets/circleCli";
describe("idempotency keys for the Circle CLI", () => {
  it("are UUIDs (the real CLI refuses anything else), stable for the same text, and different for different text", () => {
    const k = "settle:0xed469d1cd41677f95461103ea9ba22330f41f41f3ae1759adeaaf6066c33057c:1791986644";
    expect(idempotencyUuid(k)).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(idempotencyUuid(k)).toBe(idempotencyUuid(k));
    expect(idempotencyUuid(k)).not.toBe(idempotencyUuid(k + "1"));
  });
});
