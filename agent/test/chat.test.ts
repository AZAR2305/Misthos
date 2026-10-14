import { describe, expect, it } from "vitest";
import { ChatAgent, buyerTools, supplierTools, type AgentModel, type BuyerChatDeps, type ProposeArgs, type SupplierChatDeps } from "../src/agents/index.js";
import { ModelUnavailableError, ProposalInvalidError } from "../src/agents/model.js";

const USD = 1_000_000n;
const A = "0x" + "aa".repeat(32);
const B = "0x" + "bb".repeat(32);
const C = "0xaa" + "cc".repeat(31); // shares the first 4 characters with A, to test ambiguity

/** Records every request the model sees, and answers with whatever the test scripted. */
class Model implements AgentModel {
  seen: ProposeArgs<unknown>[] = [];
  constructor(private readonly answer: unknown | (() => never)) {}
  async propose<T>(a: ProposeArgs<T>): Promise<T> {
    this.seen.push(a as ProposeArgs<unknown>);
    if (typeof this.answer === "function") (this.answer as () => never)();
    const r = a.schema.safeParse(this.answer);
    if (!r.success) throw new ProposalInvalidError("does not fit");
    return r.data;
  }
}

function supplier(model: AgentModel = new Model({ tool: "unsupported", args: { reason: "nothing fits" } })) {
  const calls: string[] = [];
  const deps: SupplierChatDeps = {
    health: async () => ({ wallet: { ok: true }, modelConfigured: true }),
    decisions: (n) => [{ at: 1_800_000_000, outcome: "auto_apply", reason: `last ${n}` }],
    listInvoices: async () => [
      { id: A, counterparty: "0x" + "11".repeat(20), amount: 2_500n * USD, dueSec: 1_805_000_000, status: "approved" },
      { id: B, counterparty: "0x" + "22".repeat(20), amount: 900n * USD, dueSec: 1_806_000_000, status: "registered" },
    ],
    explain: async (id) => (calls.push(`explain:${id}`), `range for ${id.slice(0, 8)}`),
    negotiate: async (id) => (calls.push(`negotiate:${id}`), `Accepted at 0%.`),
  };
  return { chat: new ChatAgent({ role: "supplier", model, tools: supplierTools(deps) }), calls, model };
}

describe("the text agent does what is asked, and only that", () => {
  it("answers plain requests from code without asking the model at all", async () => {
    const m = new Model({ tool: "unsupported", args: { reason: "x" } });
    const { chat } = supplier(m);
    for (const q of ["status", "list invoices", "my invoices", "help", "recent decisions"]) { const r = await chat.handle(q); expect(r.kind, q + " " + JSON.stringify(r)).toBe("answer"); }
    expect(m.seen).toHaveLength(0); // a clear request never depends on a model
    const list = await chat.handle("list invoices");
    expect(list.kind === "answer" && list.text).toContain("$2,500.00");
    expect(list.kind === "answer" && list.text).toContain("approved");
  });

  it("a money action does not run on the first message: it describes itself and waits for a one-time code", async () => {
    const { chat, calls } = supplier();
    const r = await chat.handle(`negotiate ${A.slice(0, 12)}`);
    expect(r.kind).toBe("confirm");
    expect(calls).toEqual([]); // nothing happened yet
    if (r.kind !== "confirm") return;
    expect(r.text).toMatch(/\$2,500\.00/);
    expect(r.text).toMatch(/0%/);
    expect(r.text).toMatch(/Nothing has happened yet/);
    expect(await chat.confirm("not-the-code")).toMatchObject({ kind: "refused", code: "NO_SUCH_CONFIRMATION" });
    expect(calls).toEqual([]);
    const done = await chat.confirm(r.token);
    expect(done).toMatchObject({ kind: "answer", text: "Accepted at 0%." });
    expect(calls).toEqual([`negotiate:${A}`]); // the exact invoice that was described
    expect(await chat.confirm(r.token)).toMatchObject({ kind: "refused", code: "NO_SUCH_CONFIRMATION" }); // single use
    expect(calls).toHaveLength(1);
  });

  it("a confirmation runs the arguments that were described, not a new reading of anything", async () => {
    const { chat, calls } = supplier();
    const r = await chat.handle(`negotiate ${A.slice(0, 12)}`);
    // a different message in between changes nothing about the pending action
    await chat.handle(`negotiate ${B.slice(0, 12)}`);
    if (r.kind !== "confirm") throw new Error("expected a confirmation");
    await chat.confirm(r.token);
    expect(calls).toEqual([`negotiate:${A}`]);
  });

  it("cancel does nothing, and a confirmation expires after two minutes", async () => {
    let t = 1_000_000;
    const calls: string[] = [];
    const deps: SupplierChatDeps = { health: async () => ({ wallet: { ok: true }, modelConfigured: true }), decisions: () => [], listInvoices: async () => [{ id: A, counterparty: "0x" + "11".repeat(20), amount: USD, dueSec: 1_805_000_000, status: "approved" }], explain: async () => "", negotiate: async (id) => (calls.push(id), "ok") };
    const chat = new ChatAgent({ role: "supplier", model: new Model({}), tools: supplierTools(deps), now: () => t });
    const a = await chat.handle(`negotiate ${A.slice(0, 10)}`);
    if (a.kind !== "confirm") throw new Error("x");
    expect(chat.cancel(a.token).text).toMatch(/Cancelled/);
    expect(await chat.confirm(a.token)).toMatchObject({ code: "NO_SUCH_CONFIRMATION" });
    const b = await chat.handle(`negotiate ${A.slice(0, 10)}`);
    if (b.kind !== "confirm") throw new Error("x");
    t += 121_000;
    expect(await chat.confirm(b.token)).toMatchObject({ code: "NO_SUCH_CONFIRMATION" });
    expect(calls).toEqual([]);
  });

  it("refuses an invoice that is not yours, an ambiguous prefix and a malformed id, and does nothing", async () => {
    const { chat, calls } = supplier();
    expect(await chat.handle("negotiate 0xdeadbeefdeadbeef")).toMatchObject({ kind: "refused", code: "TOOL_FAILED" }); // describe() resolves it and finds nothing
    expect(calls).toEqual([]);
    // two invoices share a prefix: never guess
    const deps: SupplierChatDeps = { health: async () => ({ wallet: { ok: true }, modelConfigured: true }), decisions: () => [], listInvoices: async () => [{ id: A, counterparty: "0x1", amount: USD, dueSec: 1_805_000_000, status: "approved" }, { id: C, counterparty: "0x1", amount: USD, dueSec: 1_805_000_000, status: "approved" }], explain: async () => "", negotiate: async () => "ok" };
    const amb = new ChatAgent({ role: "supplier", model: new Model({}), tools: supplierTools(deps) });
    const r = await amb.handle("explain 0xaa");
    expect(r).toMatchObject({ kind: "refused" });
    expect((await amb.handle("explain 0xaaaaaaaa"))).toMatchObject({ kind: "answer" }); // a longer prefix resolves it (only A starts with 0xaaaaaaaa)
  });

  it("the model may pick a tool for a free-form request, but its answer must fit exactly or nothing happens", async () => {
    const good = new Model({ tool: "list_invoices", args: {} });
    const { chat } = supplier(good);
    expect(await chat.handle("what have I got outstanding with customers this month")).toMatchObject({ kind: "answer", tool: "list_invoices" });
    expect(good.seen).toHaveLength(1);
    // the model sees the request and the tool names, never anything else about the business
    expect(JSON.stringify(good.seen[0]!.snapshot)).not.toMatch(/0x|2,500|amount/);

    for (const bad of [{ tool: "transfer_funds", args: { to: "0x1" } }, { tool: "negotiate", args: { invoice: A, rate: 9999 } }, { tool: "negotiate", args: {} }, "free text", { tool: "list_invoices", args: {}, extra: 1 }]) {
      const { chat: c2, calls } = supplier(new Model(bad));
      const r = await c2.handle("do something clever");
      expect(r.kind === "refused", JSON.stringify(bad)).toBe(true);
      expect(calls).toEqual([]);
    }
  });

  it("a model-picked money action still needs the confirmation, and a model cannot confirm it", async () => {
    const { chat, calls } = supplier(new Model({ tool: "negotiate", args: { invoice: A } }));
    const r = await chat.handle("please sort out getting paid on the big one");
    expect(r.kind).toBe("confirm");
    expect(calls).toEqual([]);
  });

  it("with the model down it still serves plain requests, and says plainly that free words need the model", async () => {
    const { chat } = supplier(new Model(() => { throw new ModelUnavailableError("down"); }));
    expect((await chat.handle("status")).kind).toBe("answer");
    expect(await chat.handle("sort out my cash")).toMatchObject({ kind: "refused", code: "MODEL_UNAVAILABLE" });
    const { chat: c2 } = supplier(new Model(() => { throw new ProposalInvalidError("bad"); }));
    expect(await c2.handle("sort out my cash")).toMatchObject({ kind: "refused", code: "PROPOSAL_INVALID" });
  });

  it("strips control characters, caps the length, and treats empty input as a question", async () => {
    const { chat } = supplier();
    expect(await chat.handle("   ")).toMatchObject({ kind: "refused" });
    expect((await chat.handle("sta\u0000tus")).kind).not.toBe("confirm");
    expect((await chat.handle("status" + " ".repeat(2000) + "x")).kind).toBe("answer"); // truncated to 500 characters: still "status"
  });

  it("a failing tool reports the failure and does nothing else", async () => {
    const deps: SupplierChatDeps = { health: async () => { throw new Error("wallet unreachable"); }, decisions: () => [], listInvoices: async () => [], explain: async () => "", negotiate: async () => "" };
    const chat = new ChatAgent({ role: "supplier", model: new Model({}), tools: supplierTools(deps) });
    const r = await chat.handle("status");
    expect(r).toMatchObject({ kind: "refused", code: "TOOL_FAILED" });
    expect(r.kind === "refused" && r.text).toContain("wallet unreachable");
  });
});

describe("the buyer's text agent", () => {
  const make = () => {
    const calls: string[] = [];
    const payments: Array<{ id: string; label: string; amount: bigint; dueSec: number; kind: string }> = [];
    const deps: BuyerChatDeps = {
      health: async () => ({ wallet: { ok: true }, modelConfigured: true }),
      decisions: () => [],
      payables: async () => [{ id: A, counterparty: "0x" + "11".repeat(20), amount: 2_000n * USD, dueSec: 1_805_000_000, status: "approved" }],
      held: () => [{ id: B, reason: "above the amount I may sign alone" }],
      plan: async () => ({ text: "Pay A early: earns $8.00.", ids: [A] }),
      executePlan: async () => (calls.push("execute"), "Paid 1 invoice."),
      acceptHeld: async (id) => (calls.push(`accept:${id}`), "Accepted and paid."),
      payments: () => payments,
      addPayment: (p) => (payments.push({ id: "p1", ...p }), calls.push(`add:${p.label}:${p.amount}`), "Added."),
    };
    return { chat: new ChatAgent({ role: "buyer", model: new Model({ tool: "unsupported", args: { reason: "x" } }), tools: buyerTools(deps) }), calls, payments };
  };

  it("reads freely: what I owe, what is held, the plan, with exact numbers", async () => {
    const { chat, calls } = make();
    expect(await chat.handle("what do I owe")).toMatchObject({ kind: "answer" });
    const held = await chat.handle("what is waiting");
    expect(held.kind === "answer" && held.text).toContain("above the amount");
    expect(await chat.handle("plan")).toMatchObject({ kind: "answer", text: "Pay A early: earns $8.00." });
    expect(calls).toEqual([]); // reading changed nothing
  });

  it("paying is always a two-step: describe, then confirm", async () => {
    const { chat, calls } = make();
    const r = await chat.handle("execute plan");
    expect(r).toMatchObject({ kind: "confirm" });
    expect(calls).toEqual([]);
    if (r.kind === "confirm") await chat.confirm(r.token);
    expect(calls).toEqual(["execute"]);
    const h = await chat.handle(`accept ${B.slice(0, 10)}`);
    expect(h.kind === "confirm" && h.text).toContain("above the amount I may sign alone");
    if (h.kind === "confirm") await chat.confirm(h.token);
    expect(calls).toEqual(["execute", `accept:${B}`]);
    // only a HELD invoice can be accepted this way: an invoice that is merely owed cannot
    expect(await chat.handle(`accept ${A.slice(0, 10)}`)).toMatchObject({ kind: "refused" });
  });

  it("adds an upcoming payment from a plain sentence, after confirmation, with money in exact units", async () => {
    const { chat, calls, payments } = make();
    const r = await chat.handle("add payment Payroll Nov 3,000.50 on 2026-11-30");
    expect(r.kind).toBe("confirm");
    expect(r.kind === "confirm" && r.text).toContain("$3,000.50");
    expect(payments).toHaveLength(0);
    if (r.kind === "confirm") await chat.confirm(r.token);
    expect(calls).toEqual(["add:Payroll Nov:3000500000"]);
    expect(payments[0]).toMatchObject({ amount: 3_000_500_000n, kind: "payroll", dueSec: Date.parse("2026-11-30T00:00:00Z") / 1000 });
    // a bad amount or date never reaches the store
    for (const q of ["add payment Rent 12.3456789 on 2026-11-30", "add payment Rent 100 on 2026-13-45"]) {
      const bad = await chat.handle(q);
      if (bad.kind === "confirm") await chat.confirm(bad.token);
    }
    expect(payments).toHaveLength(1);
  });
});
