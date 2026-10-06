import type { Db } from "./db";

/**
 * Durable outbox for chain writes (spec 6). A job is identified by a deterministic idempotency key, so asking for the same
 * thing twice, or restarting the process mid-way, never sends twice. Handlers must themselves be safe to run again (they
 * check the chain before sending), because a crash can leave a job "running" after its transaction was already broadcast.
 */
export type JobStatus = "pending" | "running" | "done" | "failed";

export interface Job {
  id: string;
  key: string;
  kind: string;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  lastError: string | null;
  result: unknown;
  runAfter: Date;
  createdAt: Date;
}

interface Row {
  id: string;
  idempotency_key: string;
  kind: string;
  payload_json: unknown;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  result_json: unknown;
  run_after: Date;
  created_at: Date;
}
const COLS = "id, idempotency_key, kind, payload_json, status, attempts, last_error, result_json, run_after, created_at";
const toJob = (r: Row): Job => ({
  id: r.id,
  key: r.idempotency_key,
  kind: r.kind,
  payload: r.payload_json,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  result: r.result_json,
  runAfter: new Date(r.run_after),
  createdAt: new Date(r.created_at),
});

/** Thrown by a handler. retryable=false means the job fails now (a bad signature will not get better by waiting). */
export class JobError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "JobError";
  }
}

export async function enqueue(db: Db, args: { kind: string; key: string; payload: unknown; accountId?: string }): Promise<{ job: Job; created: boolean }> {
  const ins = await db.query<Row>(
    `insert into jobs (idempotency_key, kind, payload_json, account_id) values ($1, $2, $3::jsonb, $4)
     on conflict (idempotency_key) do nothing returning ${COLS}`,
    [args.key, args.kind, JSON.stringify(args.payload), args.accountId ?? null],
  );
  if (ins[0]) return { job: toJob(ins[0]), created: true };
  const existing = await db.query<Row>(`select ${COLS} from jobs where idempotency_key = $1`, [args.key]);
  return { job: toJob(existing[0]!), created: false };
}

export async function getJob(db: Db, id: string): Promise<Job | null> {
  const r = await db.query<Row>(`select ${COLS} from jobs where id::text = $1`, [id]);
  return r[0] ? toJob(r[0]) : null;
}

export type Handler = (payload: never, job: Job) => Promise<unknown>;
export type Handlers = Record<string, Handler>;

export interface WorkerOptions {
  maxAttempts?: number;
  /** Delay before the n-th retry, in ms. */
  backoffMs?: (attempt: number) => number;
  now?: () => Date;
}

/** Claims the oldest runnable job, runs its handler, and records the outcome. Returns the finished job, or null if idle. */
export async function runNextJob(db: Db, handlers: Handlers, o: WorkerOptions = {}): Promise<Job | null> {
  const now = (o.now ?? (() => new Date()))();
  const claimed = await db.tx(async (t) => {
    const r = await t.query<Row>(
      `select ${COLS} from jobs where status = 'pending' and run_after <= $1 order by created_at limit 1 for update skip locked`,
      [now.toISOString()],
    );
    if (!r[0]) return null;
    const u = await t.query<Row>(`update jobs set status = 'running', attempts = attempts + 1 where id = $1 returning ${COLS}`, [r[0].id]);
    return toJob(u[0]!);
  });
  if (!claimed) return null;

  const handler = handlers[claimed.kind];
  try {
    if (!handler) throw new JobError(`no handler for job kind "${claimed.kind}"`, "NO_HANDLER");
    const result = await handler(claimed.payload as never, claimed);
    const done = await db.query<Row>(
      `update jobs set status = 'done', result_json = $2::jsonb, last_error = null where id = $1 returning ${COLS}`,
      [claimed.id, JSON.stringify(result ?? null)],
    );
    return toJob(done[0]!);
  } catch (e) {
    const err = e instanceof JobError ? e : new JobError(e instanceof Error ? e.message : String(e), "ERROR", true);
    const max = o.maxAttempts ?? 5;
    const retry = err.retryable && claimed.attempts < max;
    const wait = (o.backoffMs ?? ((n) => Math.min(60_000, 1000 * 2 ** n)))(claimed.attempts);
    const after = new Date(now.getTime() + wait);
    const r = await db.query<Row>(`update jobs set status = $2, last_error = $3, run_after = $4 where id = $1 returning ${COLS}`, [
      claimed.id,
      retry ? "pending" : "failed",
      `${err.code}: ${err.message}`,
      after.toISOString(),
    ]);
    return toJob(r[0]!);
  }
}

/** Jobs left "running" by a crash go back to pending. Safe because every handler checks the chain before it sends. */
export async function recoverRunning(db: Db): Promise<number> {
  const r = await db.query<{ id: string }>("update jobs set status = 'pending' where status = 'running' returning id");
  return r.length;
}

export function startWorker(db: Db, handlers: Handlers, pollMs = 1000, o: WorkerOptions = {}) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const errors: string[] = [];
  const tick = async () => {
    try {
      while (!stopped && (await runNextJob(db, handlers, o)) !== null) {
        /* drain */
      }
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      if (errors.length > 20) errors.shift();
    }
    if (!stopped) timer = setTimeout(tick, pollMs);
  };
  void recoverRunning(db).then(tick);
  return {
    errors,
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
