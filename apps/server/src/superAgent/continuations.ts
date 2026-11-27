import * as Effect from "effect/Effect";
import { CommandId, MessageId, OrchestratorMcpThreadSendResult } from "@t3tools/contracts";
import type { SuperAgentStore } from "./SuperAgentStore.ts";
import type { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import type { PeerMcpClient } from "../peer/PeerMcpClient.ts";
/** Durable, exact-session native sends; success is acceptance, never task completion. */
export const deliverContinuations = Effect.fn("SuperAgent.deliverContinuations")(function* (
  store: SuperAgentStore["Service"],
  threads: Pick<ThreadManagementService["Service"], "getThreadShell" | "sendToThread">,
  peers: PeerMcpClient["Service"],
) {
  const state = yield* store.stored;
  for (const item of state.continuations) {
    yield* Effect.gen(function* () {
      if (item.environmentId) {
        yield* peers.call({
          environmentId: item.environmentId,
          tool: "t3_thread_send",
          arguments: {
            threadId: item.threadId,
            message: item.text,
            mode: "auto",
            clientRequestId: item.id,
          },
          limits: { runtimeMode: "full-access", interactionMode: "default" },
          success: OrchestratorMcpThreadSendResult,
        });
      } else {
        const worker = yield* threads.getThreadShell(item.threadId);
        if (!worker || worker.archivedAt || worker.deletedAt) return;
        yield* threads.sendToThread({
          projectId: worker.projectId,
          threadId: item.threadId,
          commandId: CommandId.make(item.id),
          messageId: MessageId.make(item.id),
          text: item.text,
          attachments: [],
          mode: "queue",
          createdBy: "system",
          creationSource: "server",
        });
      }
      yield* store.acknowledgeContinuation(item.id);
    }).pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Goal continuation is unconfirmed; the original native request identity is retained.",
        ),
      ),
    );
  }
});
