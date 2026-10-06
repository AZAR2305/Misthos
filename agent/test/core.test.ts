import { describe, expect, it } from "vitest";
import { encodeAbiParameters, hashTypedData, keccak256, parseAbiParameters, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_PREFS,
  GENESIS_HASH,
  MoneyError,
  allocate,
  buildLadder,
  canonicalJson,
  costOfWaiting,
  discountOf,
  domain,
  effectiveAprBps,
  evaluateOffer,
  formatMinor,
  formatUsd,
  hashDecision,
  invoiceId,
  invoiceTypedData,
  nearestRank,
  offerDigest,
  offerTypedData,
  priceOffer,
  recoverSigner,
  startRate,
  toMinor,
  typedDataJson,
  verifyChain,
  type BuyerPolicy,
  type Candidate,
  type StoredDecision,
} from "../src/core/index.js";

// Golden fixtures: CLAUDE.md Appendix B (exact 6-decimal minor units, floor rounding).
const DAY = 86_400n;
const USD = 1_000_000n;

describe("money", () => {
  it("converts strings without floats", () => {
    expect(toMinor("2000")).toBe(2_000_000_000n);
    expect(toMinor("1985.205480")).toBe(1_985_205_480n);
    expect(toMinor("0.000001")).toBe(1n);
    expect(formatMinor(1_985_205_480n)).toBe("1985.205480");
    expect(formatUsd(1_985_205_480n)).toBe("$1,985.21");
    expect(formatUsd(47_671_232n)).toBe("$47.67");
  });
  it("rejects anything that is not plain USDC digits", () => {
    for (const bad of ["", "-1", "1e6", "1.1234567", "abc", "1,000"]) expect(() => toMinor(bad)).toThrow(MoneyError);
  });
});

describe("pricing (Appendix B)", () => {
  const amount = 2_000_000_000n;
  const secs = 27n * DAY;
  it("single invoice: 1000 bps, 27 days early", () => {
    const p = priceOffer(amount, 1000, secs, 1000);
    expect(p.discount).toBe(14_794_520n);
    expect(p.net).toBe(1_985_205_480n);
    expect(p.net + p.discount).toBe(amount);
    expect(p.fee).toBe(1_479_452n); // 10% of the discount, floored
    expect(effectiveAprBps(p.discount, p.net, secs)).toBe(1007n); // 10.07%
  });
  it("ladder rung discounts", () => {
    expect(discountOf(amount, 600, secs)).toBe(8_876_712n);
    expect(discountOf(amount, 800, secs)).toBe(11_835_616n);
    expect(discountOf(amount, 1000, secs)).toBe(14_794_520n);
  });
  it("zero rate: no discount, no fee, net equals face", () => {
    const p = priceOffer(amount, 0, secs, 1000);
    expect(p.discount).toBe(0n);
    expect(p.fee).toBe(0n);
    expect(p.net).toBe(amount);
  });
  it("supplier cost of waiting at 22% and the volume example", () => {
    expect(costOfWaiting(amount, 2200, secs)).toBe(32_547_945n); // $32.55
    expect(discountOf(100_000n * USD, 1200, 25n * DAY)).toBe(821_917_808n); // about $821.92
  });
  it("refuses a discount at or above the face amount", () => {
    expect(() => priceOffer(1000n, 5000, 800n * DAY)).toThrow(RangeError);
  });
});

describe("ladder", () => {
  it("nearest-rank p25 (Appendix B: [400, 600, 600] gives 400)", () => {
    expect(nearestRank([600, 400, 600], 0.25)).toBe(400);
  });
  it("adaptive start needs three past deals, otherwise uses the preference", () => {
    const prefs = { ...DEFAULT_PREFS, startRateBps: 0 };
    expect(startRate(prefs, [400, 600, 600])).toBe(400);
    expect(startRate(prefs, [400, 600])).toBe(0);
    expect(startRate({ ...prefs, startRateBps: 300 }, [])).toBe(300);
  });
  it("Appendix B ladder: start 600, step 200 up to 1000", () => {
    const prefs = { ...DEFAULT_PREFS, startRateBps: 600, stepBps: 200, maxRateBps: 1000 };
    expect(buildLadder(prefs)).toEqual([600, 800, 1000]);
  });
  it("never prices within 200 bps of the cost of waiting, and stays short", () => {
    const rungs = buildLadder({ ...DEFAULT_PREFS, costOfWaitingAprBps: 2200 });
    expect(Math.max(...rungs)).toBe(2000);
    expect(rungs.length).toBeLessThanOrEqual(6);
    expect(rungs[0]).toBe(0);
  });
  it("a tiny cost of waiting collapses to a single zero rung", () => {
    expect(buildLadder({ ...DEFAULT_PREFS, costOfWaitingAprBps: 100 })).toEqual([0]);
  });
});

const policy = (over: Partial<BuyerPolicy> = {}): BuyerPolicy => ({
  hurdleAprBps: 0,
  liquidityFloor: 5_000n * USD,
  perInvoiceCap: 0n,
  dailyCap: 0n,
  humanAbove: 0n,
  feeBps: 0,
  ...over,
});

const NOW = 1_800_000_000n;
const cand = (id: string, faceUsd: bigint, days: bigint, rate: number, over: Partial<Candidate> = {}): Candidate => ({
  id,
  face: faceUsd * USD,
  dueSec: NOW + days * DAY,
  status: "approved",
  offerRateBps: rate,
  offerExpirySec: NOW + DAY,
  ...over,
});
const A = () => cand("A", 2000n, 27n, 1000);
const B = () => cand("B", 3500n, 20n, 1400);
const C = () => cand("C", 1200n, 10n, 900);
const D = () => cand("D", 4000n, 25n, 1200);

describe("buyer policy: reason codes", () => {
  it("hurdle 1000: rungs 600 and 800 are BELOW_HURDLE, 1000 is accepted", () => {
    const p = policy({ hurdleAprBps: 1000 });
    for (const r of [600, 800]) {
      const ev = evaluateOffer(p, cand("A", 2000n, 27n, r), NOW);
      expect(ev).toMatchObject({ ok: false, reason: "BELOW_HURDLE" });
      expect(JSON.stringify(ev)).not.toContain("1000"); // never reveals the hurdle
    }
    expect(evaluateOffer(p, cand("A", 2000n, 27n, 1000), NOW).ok).toBe(true);
  });
  it("zero hurdle accepts the 0 bps rung immediately", () => {
    expect(evaluateOffer(policy({ hurdleAprBps: 0 }), cand("A", 2000n, 27n, 0), NOW).ok).toBe(true);
  });
  it("flags expired, disputed, unapproved and reputation-blocked offers", () => {
    const p = policy();
    expect(evaluateOffer(p, cand("A", 1n, 5n, 0, { offerExpirySec: NOW - 1n }), NOW)).toMatchObject({ reason: "EXPIRED" });
    expect(evaluateOffer(p, cand("A", 1n, 5n, 0, { status: "disputed" }), NOW)).toMatchObject({ reason: "DISPUTED" });
    expect(evaluateOffer(p, cand("A", 1n, 5n, 0, { status: "registered" }), NOW)).toMatchObject({ reason: "NOT_ELIGIBLE" });
    expect(evaluateOffer(p, cand("A", 1n, 5n, 0, { reputationBlocked: true }), NOW)).toMatchObject({ reason: "REPUTATION_FLAG" });
  });
  it("escalates above the human sign-off amount", () => {
    const ev = evaluateOffer(policy({ humanAbove: 1_000n * USD }), A(), NOW);
    expect(ev).toMatchObject({ ok: false, reason: "NEEDS_HUMAN_APPROVAL" });
  });
});

describe("allocator (Appendix B)", () => {
  // Fixture: cash above the floor is 7,000. It names no payables schedule, so look at spare cash only.
  const base = {
    nowSec: NOW,
    cash: 12_000n * USD,
    obligations: [],
    candidates: [A(), B(), C(), D()],
    includeUnselectedDue: false,
  };

  it("feasible set totals match the table", () => {
    const d = (c: Candidate) => discountOf(c.face, c.offerRateBps, c.dueSec - NOW);
    expect(d(A()) + d(B())).toBe(41_643_835n);
    expect(d(A()) + d(C())).toBe(17_753_424n);
    expect(d(A()) + d(D())).toBe(47_671_232n);
    expect(d(B()) + d(C())).toBe(29_808_219n);
    expect(d(C()) + d(D())).toBe(35_835_616n);
    expect(d(A()) + d(B()) + d(C())).toBe(44_602_739n);
  });

  it("returns {A, D} with 47_671_232; greedy by rate returns {B, A, C} with 44_602_739", () => {
    const r = allocate({ ...base, policy: policy() });
    expect(r.ids).toEqual(["A", "D"]);
    expect(r.totalDiscount).toBe(47_671_232n);
    expect(r.greedy.ids).toEqual(["B", "A", "C"]);
    expect(r.greedy.totalDiscount).toBe(44_602_739n);
    expect(r.explanation).toBe("A+D beats B+A+C: $47.67 vs $44.60 with $7,000.00 of cash above the floor.");
    expect(r.cashPath[0]!.accelerated).toBe(12_000n * USD - r.totalOutflow);
  });

  it("same answer with the 10% success fee in the cash outflow", () => {
    const r = allocate({ ...base, policy: policy({ feeBps: 1000 }) });
    expect(r.ids).toEqual(["A", "D"]);
    expect(r.totalFee).toBe(1_479_452n + 3_287_671n);
  });

  it("a payroll obligation makes {A, D} infeasible on the cash path, so D is dropped", () => {
    const r = allocate({
      ...base,
      policy: policy(),
      obligations: [{ id: "payroll", dueSec: NOW + 9n * DAY, amount: 4_000n * USD }],
    });
    expect(r.ids).not.toContain("D");
    expect(r.ids).toEqual(["A"]); // A+C needs 3,182 but only 3,000 is free on day 9
    expect(r.cashPath.every((p) => p.accelerated >= 5_000n * USD)).toBe(true);
    expect(r.excluded.find((e) => e.id === "D")?.reason).toBe("LIQUIDITY_FLOOR");
  });

  it("counts unselected invoices falling due on the cash path by default (spec 8.3)", () => {
    // 12,000 cash cannot cover 10,700 of payables on top of a 5,000 floor, so nothing is feasible.
    const r = allocate({ ...base, includeUnselectedDue: true, policy: policy() });
    expect(r.baselineBreach).toBe(true);
    expect(r.explanation).toMatch(/under the liquidity floor|no eligible offer/);
    // With enough cash for the payables, the spare-cash limit is no longer the binding one.
    const rich = allocate({ ...base, cash: 30_000n * USD, includeUnselectedDue: true, policy: policy() });
    expect(rich.baselineBreach).toBe(false);
    expect(rich.ids.sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("sends invoices above the sign-off amount to needs_approval and never auto-selects them", () => {
    const r = allocate({ ...base, policy: policy({ humanAbove: 3_000n * USD }) });
    expect(r.needsApproval.sort()).toEqual(["B", "D"]);
    expect(r.ids.sort()).toEqual(["A", "C"]);
  });

  it("respects the daily cap and the per-invoice cap", () => {
    const daily = allocate({ ...base, policy: policy({ dailyCap: 2_500n * USD }) });
    expect(daily.totalOutflow).toBeLessThanOrEqual(2_500n * USD);
    const spent = allocate({ ...base, spentToday: 2_600n * USD, policy: policy({ dailyCap: 2_500n * USD }) });
    expect(spent.ids).toEqual([]);
    const per = allocate({ ...base, policy: policy({ perInvoiceCap: 2_000n * USD }) });
    expect(per.excluded.filter((e) => e.reason === "NOT_ELIGIBLE").map((e) => e.id).sort()).toEqual(["B", "D"]);
  });

  it("is deterministic and breaks ties toward fewer invoices", () => {
    const one = allocate({ ...base, policy: policy(), candidates: [cand("X", 1000n, 10n, 0), cand("Y", 1000n, 10n, 0)] });
    expect(one.ids).toEqual([]); // zero discounts: nothing to gain, fewest invoices wins
    const again = allocate({ ...base, policy: policy() });
    expect(allocate({ ...base, policy: policy() }).ids).toEqual(again.ids);
  });

  it("hurdle excludes below-hurdle offers with BELOW_HURDLE", () => {
    const r = allocate({ ...base, policy: policy({ hurdleAprBps: 1000 }) });
    expect(r.excluded.find((e) => e.id === "C")).toMatchObject({ reason: "BELOW_HURDLE" });
    expect(r.ids.every((id) => id !== "C")).toBe(true);
  });
});

describe("decision log hash chain", () => {
  const entry = (prev: `0x${string}`, reason: string): StoredDecision => {
    const e = { prevHash: prev, actor: "buyer_agent" as const, snapshot: { b: 2n, a: 1 }, proposal: null, outcome: "auto_apply" as const, reason };
    return { ...e, hash: hashDecision(e) };
  };
  it("canonical JSON sorts keys and stringifies bigint", () => {
    expect(canonicalJson({ b: 2n, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":"2"}');
  });
  it("verifies a chain and finds the first tampered entry", () => {
    const e1 = entry(GENESIS_HASH, "one");
    const e2 = entry(e1.hash, "two");
    const e3 = entry(e2.hash, "three");
    expect(verifyChain([e1, e2, e3])).toEqual({ ok: true });
    expect(verifyChain([e1, { ...e2, reason: "edited" }, e3])).toEqual({ ok: false, badIndex: 1 });
    expect(verifyChain([e1, e3])).toEqual({ ok: false, badIndex: 1 });
  });
});

describe("EIP-712 payloads match the contract", () => {
  const d = domain(5042002, "0x00000000000000000000000000000000000000aa");
  const inv = {
    supplier: "0x00000000000000000000000000000000000000a1" as const,
    buyer: "0x00000000000000000000000000000000000000b2" as const,
    token: "0x3600000000000000000000000000000000000000" as const,
    amount: 2_000_000_000n,
    dueDate: 1_802_332_800n,
    refHash: keccak256(toHex("PO-1")),
    nonce: 7n,
  };

  // Rebuild the digest the way InvoiceBook.sol does: type string, abi.encode, then the domain separator.
  const sol = (struct: `0x${string}`) =>
    keccak256(
      ("0x1901" +
        keccak256(
          encodeAbiParameters(parseAbiParameters("bytes32, bytes32, bytes32, uint256, address"), [
            keccak256(toHex("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
            keccak256(toHex("Misthos")),
            keccak256(toHex("1")),
            BigInt(d.chainId),
            d.verifyingContract,
          ]),
        ).slice(2) +
        struct.slice(2)) as `0x${string}`,
    );

  it("invoice id equals the Solidity digest", () => {
    const th = keccak256(
      toHex("Invoice(address supplier,address buyer,address token,uint256 amount,uint64 dueDate,bytes32 refHash,uint256 nonce)"),
    );
    const struct = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, address, address, address, uint256, uint64, bytes32, uint256"), [
        th,
        inv.supplier,
        inv.buyer,
        inv.token,
        inv.amount,
        inv.dueDate,
        inv.refHash,
        inv.nonce,
      ]),
    );
    expect(invoiceId(d, inv)).toBe(sol(struct));
  });

  it("offer digest equals the Solidity digest", () => {
    const offer = { invoiceId: invoiceId(d, inv), rateBps: 1000, expiry: 1_800_086_400n, nonce: 9n };
    const th = keccak256(toHex("EarlyPayOffer(bytes32 invoiceId,uint16 rateBps,uint64 expiry,uint256 nonce)"));
    const struct = keccak256(
      encodeAbiParameters(parseAbiParameters("bytes32, bytes32, uint16, uint64, uint256"), [
        th,
        offer.invoiceId,
        offer.rateBps,
        offer.expiry,
        offer.nonce,
      ]),
    );
    expect(offerDigest(d, offer)).toBe(sol(struct));
  });

  it("a local signature recovers to the signer, and the JSON for the Circle CLI carries the domain type", async () => {
    const acct = privateKeyToAccount(keccak256(toHex("test signer")));
    const td = offerTypedData(d, { invoiceId: invoiceId(d, inv), rateBps: 0, expiry: 1n, nonce: 1n });
    const signature = await acct.signTypedData(td);
    expect(await recoverSigner({ ...td, signature })).toBe(acct.address);
    const parsed = JSON.parse(typedDataJson(td)) as { types: Record<string, unknown>; message: { nonce: string } };
    expect(Object.keys(parsed.types)).toEqual(["EIP712Domain", "EarlyPayOffer"]);
    expect(parsed.message.nonce).toBe("1");
    expect(hashTypedData(invoiceTypedData(d, inv))).toBe(invoiceId(d, inv));
  });
});
