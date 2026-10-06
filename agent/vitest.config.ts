import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One forked process: the thread pool ran out of memory on a machine with little free RAM.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});
