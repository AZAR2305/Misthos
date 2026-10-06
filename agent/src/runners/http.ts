import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { ProtocolError } from "../agents/buyer.js";
import { ModelUnavailableError, ProposalInvalidError } from "../agents/model.js";
import { WalletError } from "../wallets/types.js";

/**
 * Minimal JSON-over-HTTP server for an agent process. Responses use the spec's { ok, data, error } envelope (9.2).
 * Errors say what failed and never include stack traces or secrets.
 */
export interface Ctx {
  params: Record<string, string>;
  body: unknown;
}
export type Handler = (ctx: Ctx) => Promise<unknown>;
export type Routes = Record<string, Handler>; // key: "METHOD /path/:param"

const MAX_BODY = 64 * 1024;

export function toJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v)));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new ProtocolError("BAD_SIGNATURE", "The request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve(undefined);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new SyntaxError("The request body is not valid JSON."));
      }
    });
    req.on("error", reject);
  });
}

function match(routes: Routes, method: string, path: string): { handler: Handler; params: Record<string, string> } | undefined {
  for (const [key, handler] of Object.entries(routes)) {
    const [m, pattern] = key.split(" ") as [string, string];
    if (m !== method) continue;
    const a = pattern.split("/");
    const b = path.split("/");
    if (a.length !== b.length) continue;
    const params: Record<string, string> = {};
    if (a.every((seg, i) => (seg.startsWith(":") ? ((params[seg.slice(1)] = decodeURIComponent(b[i]!)), true) : seg === b[i]))) {
      return { handler, params };
    }
  }
  return undefined;
}

function fail(res: ServerResponse, status: number, code: string, message: string) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: { code, message } }));
}

export function serve(port: number, routes: Routes, name: string): Server {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const found = match(routes, req.method ?? "GET", url.pathname);
      if (!found) return fail(res, 404, "NOT_FOUND", "No such route.");
      const body = req.method === "POST" ? await readBody(req) : undefined;
      const data = await found.handler({ params: found.params, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, data: toJson(data) }));
    } catch (e) {
      if (e instanceof ZodError) return fail(res, 400, "BAD_REQUEST", e.issues[0]?.message ?? "The request does not match the protocol.");
      if (e instanceof SyntaxError) return fail(res, 400, "BAD_REQUEST", e.message);
      if (e instanceof ProtocolError) return fail(res, e.code === "NOT_FOUND" ? 404 : 403, e.code, e.message);
      if (e instanceof WalletError) return fail(res, 503, e.code, e.hint ? `${e.message} ${e.hint}` : e.message);
      if (e instanceof ModelUnavailableError || e instanceof ProposalInvalidError) return fail(res, 503, e.code, e.message);
      console.error(`[${name}]`, (e as Error).message);
      return fail(res, 500, "INTERNAL", "The agent hit an unexpected error. Check its log.");
    }
  });
  server.listen(port, () => console.log(`[${name}] listening on http://localhost:${port}`));
  return server;
}
