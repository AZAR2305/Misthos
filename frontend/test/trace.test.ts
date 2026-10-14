import { describe, expect, it } from "vitest";
import { payState } from "../src/lib/paystate";
import { axisMax, barPosition, buildTrace, type LogEntry } from "../src/lib/trace";

const h = (n: number) => "0x" + n.toString(16).padStart(2, "0").repeat(32);
const INV = h(0x42);

// Entries shaped exactly as the agents log them (agent/src/agents/buyer.ts and supplier.ts).
const supplierOpen: LogEntry = { actor: "supplier_agent", hash: h(1), outcome: "auto_apply", reason: "Accelerate now: 6 rungs, starting at 0 bps.", at: 100, snapshot: { invoiceId: INV, policyVersion: "supplier-policy-1", result: { code: "ACCEPT" } }, policyVersion: "supplier-policy-1" };
const buyerRung = (n: number, rate: number, code: string, at: number, extra: Record<string, unknown> = {}): LogEntry => ({
  actor: "buyer_agent",
  hash: h(10 + n),
  outcome: code === "ACCEPT" ? "auto_apply" : "rejected",
  reason: code === "ACCEPT" ? "Accepted" : "rejected",
  reasonCode: code === "ACCEPT" ? null : code,
  at,
  snapshot: { invoiceId: INV, rung: n, rateBps: rate, result: { code }, policyVersion: "buyer-policy-2", ...extra },
  policyVersion: "buyer-policy-2",
  signed: true,
});
const supplierRung = (n: number, rate: number, text: string, at: number): LogEntry => ({ actor: "supplier_agent", hash: h(30 + n), outcome: text.startsWith("Rung") && /accepted/.test(text) ? "auto_apply" : "rejected", reason: text, at, snapshot: { invoiceId: INV, rung: n, rateBps: rate } });

describe("negotiation trace", () => {
  const entries = [
    supplierOpen,
    buyerRung(0, 0, "BELOW_HURDLE", 101),
    buyerRung(1, 400, "LIQUIDITY_FLOOR", 102),
    buyerRung(2, 800, "EXPOSURE_LIMIT", 103, { exposure: { policyVersion: "exposure-3", result: "limit", evidence: [{ ref: "0xaa", kind: "settlement" }] } }),
    buyerRung(3, 1200, "ACCEPT", 104, { exposure: { policyVersion: "exposure-3", result: "ok", evidence: [{ ref: "0xaa", kind: "settlement" }, { ref: "0xbb", kind: "outstanding" }] } }),
  ];

  it("lists each rung in order with the fixed text for its code, and the policy version it ran under", () => {
    const t = buildTrace(entries);
    expect(t.rungs.map((r) => [r.rung, r.rateBps, r.code])).toEqual([[0, 0, "BELOW_HURDLE"], [1, 400, "LIQUIDITY_FLOOR"], [2, 800, "EXPOSURE_LIMIT"], [3, 1200, "ACCEPT"]]);
    expect(t.rungs[1]!.text).toBe("Paying early would take the buyer's cash under its own reserve.");
    expect(t.rungs[2]!.text).toMatch(/past its allowed limit/);
    expect(t.rungs[3]).toMatchObject({ accepted: true, text: "Accepted", policyVersion: "buyer-policy-2" });
    expect(t.accepted?.rateBps).toBe(1200);
    expect(t.ladder).toEqual({ count: 6, startBps: 0, hash: h(1) });
    expect(t.policyVersions.sort()).toEqual(["buyer-policy-2", "supplier-policy-1"]);
  });

  it("reports the credit check per rung: its policy version, result and how many on-chain records it rested on", () => {
    const t = buildTrace(entries);
    expect(t.rungs[2]!.credit).toEqual({ version: "exposure-3", result: "limit", evidenceCount: 1 });
    expect(t.rungs[3]!.credit).toEqual({ version: "exposure-3", result: "ok", evidenceCount: 2 });
    expect(t.rungs[0]!.credit).toBeUndefined();
  });

  it("does not depend on the order the entries arrive in", () => {
    expect(buildTrace([...entries].reverse())).toEqual(buildTrace(entries));
  });

  it("an offer sequence with no overlap ends with the fixed no-deal text and no accepted rung", () => {
    const t = buildTrace([
      supplierOpen,
      buyerRung(0, 600, "LIQUIDITY_FLOOR", 101),
      buyerRung(1, 1000, "LIQUIDITY_FLOOR", 102),
      { actor: "supplier_agent", hash: h(99), outcome: "rejected", reason: "Every rung was rejected: ...", reasonCode: "NO_OVERLAP", at: 103, snapshot: { invoiceId: INV, rungs: 2 } },
    ]);
    expect(t.accepted).toBeUndefined();
    expect(t.noDeal).toEqual({ text: "The supplier's lowest price and the buyer's highest price do not meet, so there is no deal.", hash: h(99) });
  });

  it("falls back to the supplier's own record of a rung when the buyer's log is not available", () => {
    const t = buildTrace([supplierRung(0, 600, "Rung 0 rejected: BELOW_HURDLE.", 101), supplierRung(1, 800, "Rung 1 accepted at 800 bps.", 102)]);
    expect(t.rungs.map((r) => [r.rung, r.code, r.accepted])).toEqual([[0, "BELOW_HURDLE", false], [1, "ACCEPT", true]]);
  });

  it("the buyer's record wins over the supplier's for the same rung", () => {
    const t = buildTrace([supplierRung(0, 600, "Rung 0 rejected: BELOW_HURDLE.", 101), buyerRung(0, 600, "LIQUIDITY_FLOOR", 102)]);
    expect(t.rungs).toHaveLength(1);
    expect(t.rungs[0]!.code).toBe("LIQUIDITY_FLOOR");
  });

  it("anything waiting for a person is listed with its fixed text, and an unknown code is shown as the code, never invented text", () => {
    const wait = (code: string, n: number): LogEntry => ({ actor: "buyer_agent", hash: h(60 + n), outcome: "needs_approval", reason: "x", reasonCode: code, at: 200 + n, snapshot: { invoiceId: INV, rung: 0, result: { code } } });
    const t = buildTrace([wait("EVIDENCE_UNAVAILABLE", 1), wait("SOMETHING_NEW", 2)]);
    expect(t.waiting.map((w) => w.text)).toEqual(["The history needed for the credit limit could not be read, so nothing is accepted.", "SOMETHING_NEW"]);
  });

  it("an empty log gives an empty trace", () => {
    expect(buildTrace([])).toEqual({ rungs: [], ladder: undefined, noDeal: undefined, waiting: [], policyVersions: [], accepted: undefined });
  });

  it("no log entry text can carry a limit: the texts are fixed and contain no digits", async () => {
    const { REASON_TEXT } = await import("../src/lib/core");
    for (const [code, text] of Object.entries(REASON_TEXT)) expect(text, code).not.toMatch(/\d/);
  });
});

describe("range bar maths", () => {
  it("positions rates on the axis and keeps the last mark off the edge", () => {
    expect(axisMax([0, 800, 1200])).toBe(1500);
    expect(axisMax([2000])).toBe(2500);
    expect(axisMax([])).toBe(1500);
    expect(barPosition(750, 1500)).toBe(50);
    expect(barPosition(-5, 1500)).toBe(0);
    expect(barPosition(9999, 1500)).toBe(100);
    expect(barPosition(5, 0)).toBe(0);
  });
});

describe("pay state: only the chain can say settled", () => {
  const accept = buyerRung(3, 1200, "ACCEPT", 104);
  const sup = supplierRung(0, 600, "Rung 0 rejected: BELOW_HURDLE.", 101);
  const walletFailure: LogEntry = { actor: "buyer_agent", hash: h(80), outcome: "needs_approval", reason: "session expired", reasonCode: "SESSION_EXPIRED", at: 105, snapshot: { invoiceId: INV, rung: 3 } };

  it("no log and not settled means no offer", () => {
    expect(payState({ chainStatus: "approved", entries: [] }).state).toBe("none");
  });
  it("a signed offer with no accept is only proposed", () => {
    expect(payState({ chainStatus: "approved", entries: [sup] }).state).toBe("proposed");
  });
  it("an accept the chain does not show yet is not paid", () => {
    const s = payState({ chainStatus: "approved", entries: [sup, accept] });
    expect(s).toMatchObject({ state: "accepted", label: "Accepted, settling" });
    expect(s.detail).toMatch(/only once Arc shows it/);
  });
  it("a wallet failure after the accept is a failed payment, never a settled one", () => {
    expect(payState({ chainStatus: "approved", entries: [sup, accept, walletFailure] })).toMatchObject({ state: "failed", code: "SESSION_EXPIRED" });
  });
  it("a later refusal for another reason (credit, cash, evidence) is not a payment failure", () => {
    const refusal: LogEntry = { ...walletFailure, reasonCode: "EXPOSURE_LIMIT" };
    expect(payState({ chainStatus: "approved", entries: [accept, refusal] }).state).toBe("accepted");
  });
  it("settled needs the chain, whatever the log says", () => {
    expect(payState({ chainStatus: "settled_early", entries: [] }).state).toBe("settled");
    expect(payState({ chainStatus: "settled_due", entries: [accept, walletFailure] }).state).toBe("settled");
    expect(payState({ chainStatus: "approved", entries: [accept] }).state).not.toBe("settled");
  });
});

import { fromAgentEntry, fromApiEntry, mergeEntries } from "../src/lib/trace";

describe("log sources", () => {
  const api = { seq: 3, actor: "buyer_agent", hash: h(5), prevHash: h(4), outcome: "rejected", reasonCode: "LIQUIDITY_FLOOR", reason: "LIQUIDITY_FLOOR: x", at: 150, snapshot: { invoiceId: INV, rung: 1, rateBps: 400, result: { code: "LIQUIDITY_FLOOR" } }, proposal: null, policyVersion: "buyer-policy-2", result: "LIQUIDITY_FLOOR", settlement: { txHash: h(9) } };
  it("reads an API entry as verified, with its settlement link", () => {
    expect(fromApiEntry(api)).toMatchObject({ actor: "buyer_agent", hash: h(5), signed: true, policyVersion: "buyer-policy-2", settlement: { txHash: h(9) } });
  });
  it("ignores anything that is not an entry", () => {
    expect(fromApiEntry(null)).toBeUndefined();
    expect(fromApiEntry({ ...api, actor: "someone" })).toBeUndefined();
    expect(fromApiEntry({ ...api, outcome: "maybe" })).toBeUndefined();
    expect(fromApiEntry({ hash: 5 })).toBeUndefined();
  });
  it("an agent's own entry is signed only once it has a signature, and the version comes from its snapshot", () => {
    const own = { ...api, policyVersion: undefined, snapshot: { ...api.snapshot, policyVersion: "buyer-policy-2" } };
    expect(fromAgentEntry(own)).toMatchObject({ signed: false, policyVersion: "buyer-policy-2" });
    expect(fromAgentEntry({ ...own, signature: "0x" + "ab".repeat(65) })?.signed).toBe(true);
  });
  it("merges two sources by hash, and the verified API copy wins", () => {
    const fromAgent = fromAgentEntry({ ...api, signature: undefined })!;
    const merged = mergeEntries([fromApiEntry(api)!], [fromAgent, fromAgentEntry({ ...api, hash: h(6) })!]);
    expect(merged).toHaveLength(2);
    expect(merged.find((e) => e.hash === h(5))!.signed).toBe(true);
  });
});

describe("the ERC-8004 reading in the trace", () => {
  const entry = (snapshot: object) => ({ actor: "buyer_agent", snapshot: { rung: 0, rateBps: 0, ...snapshot }, outcome: "rejected", reason: "x", hash: "0x" + "ab".repeat(32), at: 1, signed: true, policyVersion: "buyer-policy-1" }) as never;
  it("carries what the buyer's agent read, only from the registry source, and ignores anything else", () => {
    const t = buildTrace([entry({ result: { code: "REPUTATION_FLAG" }, reputation: { source: "erc-8004", result: "read", recentCount: 3, recentDisputed: 2 } })]);
    expect(t.rungs[0]!.reputation).toEqual({ result: "read", recentCount: 3, recentDisputed: 2 });
    expect(buildTrace([entry({ result: { code: "ACCEPT" }, reputation: { source: "made-up", result: "read" } })]).rungs[0]!.reputation).toBeUndefined();
    expect(buildTrace([entry({ result: { code: "ACCEPT" } })]).rungs[0]!.reputation).toBeUndefined();
  });
});
