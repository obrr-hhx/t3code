import { OrchestratorMcpThreadListResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { PeerLinks } from "../peer/PeerLinks.ts";
import type { PeerMcpClient } from "../peer/PeerMcpClient.ts";
import type { WorkerObservation } from "./observations.ts";

/** Poll only already-authorized T3 links; never create a connection or change credentials. */
export const readRemoteWorkers = Effect.fn("SuperAgent.readRemoteWorkers")(function* (
  links: Pick<PeerLinks["Service"], "enabled" | "names">,
  peers: PeerMcpClient["Service"],
) {
  if (!(yield* links.enabled)) return [];
  const names = yield* links.names;
  return (yield* Effect.forEach(
    names,
    (link) =>
      Effect.gen(function* () {
        const workers: WorkerObservation[] = [];
        let cursor: number | null = 0;
        while (cursor !== null) {
          const page: OrchestratorMcpThreadListResult = yield* peers.call({
            environmentId: link.environmentId,
            tool: "t3_thread_list",
            arguments: { allProjects: true, includeSubagents: true, cursor, limit: 100 },
            limits: { runtimeMode: "approval-required", interactionMode: "default" },
            success: OrchestratorMcpThreadListResult,
          });
          for (const thread of page.threads)
            workers.push({
              id: `${link.environmentId}/${thread.threadId}`,
              status: thread.status,
              run: thread.latestRunId,
              pending: thread.status === "waiting" ? `waiting:${thread.itemCount}` : null,
              items: thread.itemCount,
              updatedAt: Date.parse(thread.updatedAt),
            });
          if (page.nextCursor !== null && page.nextCursor <= cursor) break;
          cursor = page.nextCursor;
        }
        return workers;
      }).pipe(
        Effect.timeout("15 seconds"),
        Effect.orElseSucceed(() => [
          {
            id: `${link.environmentId}/connection`,
            status: "unreachable",
            run: null,
            pending: null,
            items: 0,
            updatedAt: 0,
          },
        ]),
      ),
    { concurrency: 2 },
  )).flat();
});
