/**
 * A tiny event bus between the app and the agent companion (the 3D character in the corner of every app page). Anything
 * that takes time or finishes can say so; the companion turns it into a gesture. No state lives here and nothing here
 * carries data: only a kind and a short sentence the person can read.
 */
export type AgentEvent = { kind: "working" | "done" | "error" | "hello"; text?: string };

const subs = new Set<(e: AgentEvent) => void>();

export const agentBus = {
  emit(e: AgentEvent) {
    subs.forEach((f) => f(e));
  },
  subscribe(f: (e: AgentEvent) => void) {
    subs.add(f);
    return () => {
      subs.delete(f);
    };
  },
};
