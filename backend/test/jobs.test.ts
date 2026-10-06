import { beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb, type Db } from "../src/db";
import { JobError, enqueue, getJob, recoverRunning, runNextJob } from "../src/jobs";

let db: Db;
beforeEach(async () => {
  db = await openDb("pglite://memory");
  await migrate(db);
});

const none = { backoffMs: () => 0 };

describe("job outbox", () => {
  it("is idempotent: the same key never makes a second job", async () => {
    const a = await enqueue(db, { kind: "k", key: "register:0xabc", payload: { n: 1 } });
    const b = await enqueue(db, { kind: "k", key: "register:0xabc", payload: { n: 2 } });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
    expect(b.job.payload).toEqual({ n: 1 }); // the first request wins
  });

  it("runs a job once and records the result", async () => {
    const { job } = await enqueue(db, { kind: "k", key: "a", payload: { x: 2 } });
    let calls = 0;
    const done = await runNextJob(db, { k: async (p: { x: number }) => (calls++, { doubled: p.x * 2 }) }, none);
    expect(done).toMatchObject({ id: job.id, status: "done", attempts: 1, result: { doubled: 4 } });
    expect(await runNextJob(db, { k: async () => calls++ }, none)).toBeNull(); // nothing left
    expect(calls).toBe(1);
  });

  it("retries a retryable failure with backoff, then succeeds", async () => {
    const { job } = await enqueue(db, { kind: "k", key: "retry", payload: {} });
    let n = 0;
    const handler = async () => {
      if (++n < 3) throw new JobError("rpc timeout", "SEND_FAILED", true);
      return "ok";
    };
    let t = new Date("2026-10-07T10:00:00Z");
    const o = { backoffMs: () => 5_000, now: () => t };
    expect((await runNextJob(db, { k: handler }, o))?.status).toBe("pending");
    expect(await runNextJob(db, { k: handler }, o)).toBeNull(); // not yet: backing off
    t = new Date(t.getTime() + 6_000);
    expect((await runNextJob(db, { k: handler }, o))?.status).toBe("pending");
    t = new Date(t.getTime() + 6_000);
    expect(await runNextJob(db, { k: handler }, o)).toMatchObject({ status: "done", attempts: 3 });
    expect((await getJob(db, job.id))?.lastError).toBeNull();
  });

  it("fails at once on a non-retryable error and after the attempt limit on a retryable one", async () => {
    const a = await enqueue(db, { kind: "k", key: "nr", payload: {} });
    const r = await runNextJob(db, { k: async () => { throw new JobError("BadSignature", "REVERTED", false); } }, none);
    expect(r).toMatchObject({ id: a.job.id, status: "failed", attempts: 1 });
    expect(r?.lastError).toBe("REVERTED: BadSignature");

    await enqueue(db, { kind: "k", key: "limit", payload: {} });
    const flaky = async () => { throw new Error("network down"); };
    const o = { ...none, maxAttempts: 3 };
    expect((await runNextJob(db, { k: flaky }, o))?.status).toBe("pending");
    expect((await runNextJob(db, { k: flaky }, o))?.status).toBe("pending");
    expect((await runNextJob(db, { k: flaky }, o))?.status).toBe("failed");
  });

  it("fails a job whose kind has no handler instead of dropping it", async () => {
    await enqueue(db, { kind: "mystery", key: "m", payload: {} });
    expect(await runNextJob(db, {}, none)).toMatchObject({ status: "failed", lastError: expect.stringContaining("NO_HANDLER") });
  });

  it("survives a crash: a job left running goes back to pending and is run again", async () => {
    const { job } = await enqueue(db, { kind: "k", key: "crash", payload: {} });
    // The process died after claiming the job.
    await db.query("update jobs set status = 'running', attempts = 1 where id = $1", [job.id]);
    expect(await runNextJob(db, { k: async () => "x" }, none)).toBeNull(); // a running job is not picked up twice
    expect(await recoverRunning(db)).toBe(1);
    expect(await runNextJob(db, { k: async () => "x" }, none)).toMatchObject({ status: "done", attempts: 2 });
  });

  it("two workers racing for one job run it once", async () => {
    await enqueue(db, { kind: "k", key: "race", payload: {} });
    let calls = 0;
    const slow = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
    };
    const [a, b] = await Promise.all([runNextJob(db, { k: slow }, none), runNextJob(db, { k: slow }, none)]);
    expect(calls).toBe(1);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });
});
