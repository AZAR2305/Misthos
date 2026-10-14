import { describe, expect, it } from "vitest";
import { z } from "zod";
import { GroqModel, ModelUnavailableError, ProposalInvalidError } from "../src/agents/model";

const schema = z.object({ rateBps: z.number().int() });
const args = { role: "supplier" as const, task: "propose a rate", snapshot: { amount: 5n }, schema };
const reply = (content: string, status = 200) => async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status });

describe("GroqModel", () => {
  it("sends the key and a strict-JSON request, and parses the reply with the schema", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const m = new GroqModel({ apiKey: "k", model: "m", fetch: (async (url: string, init: RequestInit) => ((seen = { url, init }), reply('{"rateBps": 200}')())) as unknown as typeof fetch });
    expect(await m.propose(args)).toEqual({ rateBps: 200 });
    expect(seen!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer k");
    const body = JSON.parse(seen!.init.body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[1].content).toContain('"amount":"5"'); // bigint became a string, never a float
    expect(body.messages[1].content).toContain("rateBps"); // the reply shape is shown to the model as JSON Schema
  });

  it("is unavailable with no key, and fails closed after two failed attempts", async () => {
    await expect(new GroqModel({ apiKey: "", model: "m" }).propose(args)).rejects.toBeInstanceOf(ModelUnavailableError);
    let calls = 0;
    const m = new GroqModel({ apiKey: "k", model: "m", retryDelayMs: 1, fetch: (async () => (calls++, reply("", 500)())) as unknown as typeof fetch });
    await expect(m.propose(args)).rejects.toBeInstanceOf(ModelUnavailableError);
    expect(calls).toBe(2);
  });

  it("rejects a reply that does not match the schema, without retrying", async () => {
    let calls = 0;
    const m = new GroqModel({ apiKey: "k", model: "m", fetch: (async () => (calls++, reply('{"rateBps": "high"}')())) as unknown as typeof fetch });
    await expect(m.propose(args)).rejects.toBeInstanceOf(ProposalInvalidError);
    expect(calls).toBe(1);
    const prose = new GroqModel({ apiKey: "k", model: "m", fetch: reply("I think 2%") as unknown as typeof fetch });
    await expect(prose.propose(args)).rejects.toBeInstanceOf(ProposalInvalidError);
  });
});
