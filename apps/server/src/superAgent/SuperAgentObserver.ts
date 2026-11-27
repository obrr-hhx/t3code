import { deliverContinuations } from "./continuations.ts";
import { CommandId, MessageId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ForgeCron from "./ForgeCron.ts";
import * as Store from "./SuperAgentStore.ts";
import * as Threads from "../orchestration-v2/ThreadManagementService.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import { readRemoteWorkers } from "./remoteWorkers.ts";
import { deliverNotices } from "./delivery.ts";
import { observe, type WorkerObservation } from "./observations.ts";

const start = Effect.gen(function* () {
  const links = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const store = yield* Store.SuperAgentStore;
  const cron = yield* ForgeCron.ForgeCron;
  const threads = yield* Threads.ThreadManagementService;
  const tick = Effect.fn("SuperAgentObserver.tick")(function* () {
    yield* store.syncMemory;
    const state = yield* store.stored;
    if (!state.threadId || !state.projectId) return;
    yield* deliverNotices(store, threads);
    if (state.observation.paused) return;
    yield* deliverContinuations(store, threads, peers);
    let pending = state.observation.pending;
    if (!pending) {
      const manager = yield* threads.getThreadShell(state.threadId);
      if (
        !manager ||
        manager.activeRunId ||
        manager.pendingRuntimeRequest ||
        manager.archivedAt ||
        manager.deletedAt
      )
        return;
      const entries = yield* threads.listProjectThreads({ includeSubagents: true });
      const workers = yield* Effect.forEach(
        entries.filter((e) => e.id !== state.threadId),
        (e) => threads.getThreadShell(e.id),
        { concurrency: 4 },
      );
      const observations: WorkerObservation[] = workers
        .filter((w) => w !== null)
        .map((w) => ({
          id: w.id,
          status: w.status,
          run: w.latestRunId,
          pending: w.pendingRuntimeRequest?.id ?? null,
          items: w.visibleItemCount,
          updatedAt: DateTime.toEpochMillis(w.updatedAt),
        }));
      const remoteWorkers = yield* readRemoteWorkers(links, peers);
      const cronWorkers = yield* cron.observe;
      const next = observe(
        state.observation,
        [...observations, ...remoteWorkers, ...cronWorkers],
        state.records,
        yield* Clock.currentTimeMillis,
      );
      if (next === state.observation) return;
      if (!(yield* store.recordObservation(next, state.observation))) return;
      pending = next.pending;
    }
    if (!pending) return;
    yield* threads.sendToThread({
      projectId: state.projectId,
      threadId: state.threadId,
      commandId: CommandId.make(pending.id),
      messageId: MessageId.make(pending.id),
      text: pending.text,
      attachments: [],
      mode: "queue",
      createdBy: "system",
      creationSource: "server",
    });
    // The request identity survives restart; a lost receipt reuses the same native command.
    const latest = yield* store.stored;
    if (latest.observation.pending?.id === pending.id)
      yield* store.recordObservation({ ...latest.observation, pending: null }, latest.observation);
  });
  yield* tick().pipe(
    Effect.catch(() =>
      Effect.logWarning(
        "Super Agent background inspection failed; durable pending work is retained.",
      ),
    ),
    Effect.andThen(Effect.sleep("60 seconds")),
    Effect.forever,
    Effect.forkScoped,
  );
});
export const layer = Layer.effectDiscard(start);
