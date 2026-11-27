// @effect-diagnostics-next-line nodeBuiltinImport:off -- A pure, bounded command identity for durable dispatch deduplication.
import * as NodeCrypto from "node:crypto";
import type { SuperAgentRecord } from "@t3tools/contracts";
export interface WorkerObservation {
  readonly id: string;
  readonly status: string;
  readonly run: string | null;
  readonly pending: string | null;
  readonly items: number;
  readonly updatedAt: number;
}
export interface ObservationState {
  readonly generation: number;
  readonly signature: string | null;
  readonly lastStall: string | null;
  readonly nextCheckAt: number | null;
  readonly pending: { readonly id: string; readonly text: string } | null;
}
export const emptyObservation = (): ObservationState => ({
  generation: 0,
  signature: null,
  lastStall: null,
  nextCheckAt: null,
  pending: null,
});
const digest = (value: string) =>
  NodeCrypto.createHash("sha256").update(value).digest("hex").slice(0, 32);
const running = new Set(["preparing", "starting", "running", "waiting", "queued"]);
export function observe(
  previous: ObservationState,
  workers: ReadonlyArray<WorkerObservation>,
  goals: ReadonlyArray<SuperAgentRecord>,
  now: number,
): ObservationState {
  if (previous.pending) return previous;
  const evidence = workers
    .toSorted((a, b) => a.id.localeCompare(b.id))
    .map((w) => [w.id, running.has(w.status) ? "active" : w.status, w.run, w.pending]);
  const signature = digest(JSON.stringify(evidence));
  if (previous.signature === null) return { ...previous, signature };
  const due = previous.nextCheckAt !== null && now >= previous.nextCheckAt;
  const stalled = due
    ? goals
        .filter((g) => g.kind === "goal" && g.status === "active" && g.workerThreadId !== null)
        .flatMap((g) => {
          const worker = workers.find(
            (w) =>
              w.id ===
              (g.workerEnvironmentId
                ? `${g.workerEnvironmentId}/${g.workerThreadId}`
                : g.workerThreadId),
          );
          return worker && !worker.pending && now - worker.updatedAt >= 20 * 60_000
            ? [[g.id, worker.id, worker.run, worker.items]]
            : [];
        })
    : [];
  const stall = stalled.length ? digest(JSON.stringify(stalled)) : null;
  const changed = signature !== previous.signature;
  const newStall = stall !== null && stall !== previous.lastStall;
  if (!changed && !newStall) return previous;
  const generation = previous.generation + 1;
  const id = `super-agent-observe:${generation}:${digest(JSON.stringify([signature, newStall ? stall : null]))}`;
  return {
    ...previous,
    signature,
    generation,
    lastStall: newStall ? stall : previous.lastStall,
    pending: {
      id,
      text: newStall
        ? "[Background review] A goal worker has had no progress for 20 minutes. Inspect the exact worker and its current task, ask for progress if needed, and continue authorized next steps. Update durable goals. Report only a material result, failure or genuine human decision; otherwise remain silent. Do not repeat an unchanged report."
        : "[Background review] Worker state changed. Inspect current structured results, reconcile goal progress and delivery receipts, and continue authorized next steps. Update durable goals and decisions. Report only a material result, failure or genuine human decision; otherwise remain silent. Do not repeat an unchanged report.",
    },
  };
}
