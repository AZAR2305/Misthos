import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { originOf, registryProblems, type OriginRegistry } from "../src/lib/origins";
import { REGISTRY } from "../src/lib/origins-registry";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const C = "0x" + "cc".repeat(20);
const note = { who: "A real baker, not on our team", notOnTeam: true, walletIsTheirs: true, date: "2026-10-15" };
const reg = (over: Partial<OriginRegistry> = {}): OriginRegistry => ({ team: [{ label: "ours", address: A }], pilots: [{ label: "Baker", wallets: [B], independence: note }], ...over });

describe("who counts as what", () => {
  it("team wins over everything: if any side is ours, it is a team run", () => {
    expect(originOf({ supplier: A, buyer: B }, reg())).toBe("team"); // even though B is a pilot wallet
    expect(originOf({ supplier: B, buyer: A.toUpperCase().replace("0X", "0x") }, reg())).toBe("team");
  });
  it("a pilot needs a wallet in a pilot entry that has a complete note, and no team wallet on either side", () => {
    expect(originOf({ supplier: B, buyer: C }, reg())).toBe("pilot");
    expect(originOf({ supplier: C, buyer: C }, reg())).toBe("unverified");
  });
  it("an incomplete note means the entry is ignored: it is unverified, not pilot", () => {
    for (const bad of [{ ...note, notOnTeam: false }, { ...note, walletIsTheirs: false }, { ...note, who: "" }, { ...note, date: "yesterday" }]) {
      const r = reg({ pilots: [{ label: "Baker", wallets: [B], independence: bad as never }] });
      expect(registryProblems(r).length).toBeGreaterThan(0);
      expect(originOf({ supplier: B, buyer: C }, r)).toBe("unverified");
    }
  });
  it("a wallet cannot be both team and pilot", () => {
    const r = reg({ pilots: [{ label: "Sneaky", wallets: [A], independence: note }] });
    expect(registryProblems(r).join(" ")).toMatch(/also a team wallet/);
    expect(originOf({ supplier: A, buyer: C }, r)).toBe("team");
  });
});

describe("the registry in the repo", () => {
  it("is valid, and lists every wallet the team has used", () => {
    expect(registryProblems(REGISTRY)).toEqual([]);
    const team = REGISTRY.team.map((t) => t.address.toLowerCase());
    for (const a of ["0x6afd3cac8e4ac3d15388b58ac999481c96ffdf6f", "0x156af8e7298fc862c54b8d72b2b232770ceefa15", "0xe56357e6efe146a33223dd90f11bca992c1b137c", "0xd8d88a6ef074004c308e240bd7f2499363e80c8d"]) expect(team).toContain(a);
  });
  it("only calls someone a pilot if docs/TRACTION.md carries the same written note", () => {
    const traction = readFileSync(new URL("../../docs/TRACTION.md", import.meta.url), "utf8");
    for (const p of REGISTRY.pilots) {
      expect(traction, `TRACTION.md has no independence note for "${p.label}"`).toContain(p.label);
      expect(traction).toContain(p.independence.date);
      expect(traction).toMatch(/independence note/i);
    }
  });
});
