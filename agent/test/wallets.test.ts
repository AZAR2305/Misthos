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
