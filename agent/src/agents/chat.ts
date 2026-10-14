import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ModelUnavailableError, ProposalInvalidError, type AgentModel } from "./model.js";

/**
 * A text interface to an agent: the owner types what they want and the agent does exactly that, or says why it cannot.
 *
 * How it stays correct (the same rule as everywhere else: the model proposes, code decides):
 *  - There is a fixed list of tools. The request is first matched by plain code against each tool's own patterns. Only if nothing matches is the model asked,
 *    and all it may do is pick ONE tool from the list with arguments that pass that tool's strict schema. It cannot invent a tool, a field or an action.
 *  - Every argument is validated again by the tool's own code (an invoice must exist, an amount must be a whole number of minor units, and so on). The model's
 *    words never reach a signer or a contract call.
 *  - A tool that moves money or changes a private setting does NOT run on the first message. The agent replies with a plain description of exactly what it
 *    would do and a one-time code that only code issued; nothing happens until that code comes back within two minutes. A confirmation runs the exact
 *    arguments that were described, never a new reading of the text.
 *  - If the model is unavailable, or its answer does not fit, the agent says so and does nothing. There is no fallback model and no guessing.
 *  - The text typed here is the owner's own instruction. Text that came from other people (invoice notes, names, claim pages) is never passed on.
 */
export interface ToolResult {
  text: string;
  data?: unknown;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// The arguments of a tool are checked by that tool's own zod schema before `run` or `describe` ever sees them, so they are typed loosely here.
export interface ChatTool {
  name: string;
  /** One line for the model and for "what can you do". */
  description: string;
  args: z.ZodTypeAny;
  /** Plain code that recognises the request without a model. Returns the arguments, or undefined if this tool is not meant. */
  match?: (text: string) => unknown | undefined;
  /** True for anything that moves money or changes a private setting: it needs an explicit confirmation. */
  confirm?: boolean;
  /** Say, in plain words and exact numbers, what will happen. Required for confirm tools. */
  describe?: (args: any) => Promise<string> | string;
  run: (args: any) => Promise<ToolResult>;
}

export type ChatReply =
  | { kind: "answer"; text: string; data?: unknown; tool: string }
  | { kind: "confirm"; text: string; token: string; tool: string; expiresInSec: number }
  | { kind: "refused"; text: string; code: "UNSUPPORTED" | "BAD_ARGUMENTS" | "MODEL_UNAVAILABLE" | "PROPOSAL_INVALID" | "NO_SUCH_CONFIRMATION" | "TOOL_FAILED" };

const MAX_TEXT = 500;
const CONFIRM_TTL_MS = 120_000;

export class ChatAgent {
  private readonly pending = new Map<string, { tool: ChatTool; args: unknown; expires: number }>();

  constructor(
    private readonly d: {
      role: "supplier" | "buyer";
      model: AgentModel;
      tools: readonly ChatTool[];
      now?: () => number;
      /** Called for every request and result: the owner's own record of what was asked and done. */
      audit?: (line: { at: number; role: string; request: string; tool: string; outcome: string }) => void;
    },
  ) {}

  private now() {
    return this.d.now?.() ?? Date.now();
  }

  private help(): string {
    return `I can: ${this.d.tools.map((t) => `${t.description}${t.confirm ? " (I ask you to confirm first)" : ""}`).join("; ")}.`;
  }

  /** The schema of the one thing the model may answer with. */
  private intentSchema() {
    const tools = this.d.tools.map((t) => z.strictObject({ tool: z.literal(t.name), args: t.args }));
    const unsupported = z.strictObject({ tool: z.literal("unsupported"), args: z.strictObject({ reason: z.string().max(200) }) });
    return z.union([...tools, unsupported] as unknown as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  async handle(raw: string): Promise<ChatReply> {
    const text = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_TEXT);
    if (!text) return { kind: "refused", code: "UNSUPPORTED", text: `Tell me what you want. ${this.help()}` };
    this.sweep();
    if (/^(help|[?]|what can you do|commands?)$/i.test(text)) return this.done(text, "help", { kind: "answer", tool: "help", text: this.help() });

    // 1. Plain code first: a clear request needs no model, and a model cannot change what a clear request means.
    let tool: ChatTool | undefined;
    let rawArgs: unknown;
    for (const t of this.d.tools) {
      const m = t.match?.(text);
      if (m !== undefined) {
        tool = t;
        rawArgs = m;
        break;
      }
    }

    // 2. Otherwise the model picks one tool from the list. Its answer must fit the schema exactly.
    if (!tool) {
      try {
        const intent = (await this.d.model.propose({
          role: this.d.role,
          task: "Pick the ONE tool that does what the person asked, with its arguments. If none fits, answer with tool \"unsupported\" and a short reason. Never invent a tool.",
          snapshot: { request: text, tools: this.d.tools.map((t) => ({ tool: t.name, does: t.description })) },
          schema: this.intentSchema(),
        })) as { tool: string; args: unknown };
        if (intent.tool === "unsupported") return this.done(text, "unsupported", { kind: "refused", code: "UNSUPPORTED", text: `I can't do that. ${this.help()}` });
        tool = this.d.tools.find((t) => t.name === intent.tool);
        rawArgs = intent.args;
      } catch (e) {
        if (e instanceof ModelUnavailableError) return this.done(text, "none", { kind: "refused", code: "MODEL_UNAVAILABLE", text: "I could not understand that in free words because my language model is unavailable, so I did nothing. Plain requests like \"status\" or \"list invoices\" still work." });
        if (e instanceof ProposalInvalidError) return this.done(text, "none", { kind: "refused", code: "PROPOSAL_INVALID", text: `I could not turn that into one of my actions, so I did nothing. ${this.help()}` });
        throw e;
      }
    }
    if (!tool) return this.done(text, "none", { kind: "refused", code: "UNSUPPORTED", text: `I can't do that. ${this.help()}` });

    // 3. Code validates the arguments, whoever proposed them.
    const parsed = tool.args.safeParse(rawArgs ?? {});
    if (!parsed.success) return this.done(text, tool.name, { kind: "refused", code: "BAD_ARGUMENTS", text: `I need valid details for that: ${parsed.error.issues[0]?.message ?? "something is missing"}.` });

    // 4. Anything that moves money or changes a private setting waits for an explicit yes.
    if (tool.confirm) {
      let what: string;
      try {
        what = tool.describe ? await tool.describe(parsed.data) : tool.description;
      } catch (e) {
        return this.done(text, tool.name, { kind: "refused", code: "TOOL_FAILED", text: `I can't do that, and nothing was done: ${(e as Error).message}` });
      }
      const token = randomBytes(6).toString("hex");
      this.pending.set(token, { tool, args: parsed.data, expires: this.now() + CONFIRM_TTL_MS });
      return this.done(text, tool.name, { kind: "confirm", tool: tool.name, token, expiresInSec: CONFIRM_TTL_MS / 1000, text: `${what} Nothing has happened yet. Confirm to go ahead, or cancel.` });
    }
    return this.run(text, tool, parsed.data);
  }

  /** Runs exactly the arguments that were described, once, within two minutes. */
  async confirm(token: string): Promise<ChatReply> {
    this.sweep();
    const p = this.pending.get(token);
    if (!p) return { kind: "refused", code: "NO_SUCH_CONFIRMATION", text: "That confirmation is not valid any more (it was used, cancelled or expired). Ask again." };
    this.pending.delete(token); // single use
    return this.run("(confirmed)", p.tool, p.args);
  }

  cancel(token: string): ChatReply {
    const had = this.pending.delete(token);
    return { kind: "answer", tool: "cancel", text: had ? "Cancelled. Nothing was done." : "There was nothing to cancel." };
  }

  private async run(request: string, tool: ChatTool, args: unknown): Promise<ChatReply> {
    try {
      const r = await tool.run(args);
      return this.done(request, tool.name, { kind: "answer", tool: tool.name, text: r.text, data: r.data });
    } catch (e) {
      return this.done(request, tool.name, { kind: "refused", code: "TOOL_FAILED", text: `That did not go through, and nothing else was done: ${(e as Error).message}` });
    }
  }

  private done(request: string, tool: string, reply: ChatReply): ChatReply {
    this.d.audit?.({ at: Math.floor(this.now() / 1000), role: this.d.role, request: request.slice(0, 200), tool, outcome: reply.kind === "refused" ? `refused:${reply.code}` : reply.kind });
    return reply;
  }

  private sweep() {
    const t = this.now();
    for (const [k, v] of this.pending) if (v.expires <= t) this.pending.delete(k);
  }
}

// ---------------------------------------------------------------------------------------------------- small shared helpers for tool definitions

/** An invoice reference typed by a person: a full 0x id or a prefix of at least 6 hex characters. */
export const invoiceRef = z.string().regex(/^0x[0-9a-fA-F]{6,64}$/, "give an invoice id, or at least its first 8 characters starting with 0x");

/** Resolve a typed reference against the ids that really exist. Ambiguity is an error, never a guess. */
export function resolveInvoice(ref: string, known: readonly string[]): string {
  const r = ref.toLowerCase();
  const hits = known.filter((k) => k.toLowerCase().startsWith(r));
  if (hits.length === 0) throw new Error(`no invoice of yours starts with ${ref}`);
  if (hits.length > 1) throw new Error(`${ref} matches more than one invoice (${hits.slice(0, 3).map((h) => h.slice(0, 12)).join(", ")}); give more characters`);
  return hits[0]!;
}

export const ID_IN_TEXT = /0x[0-9a-fA-F]{6,64}/;
