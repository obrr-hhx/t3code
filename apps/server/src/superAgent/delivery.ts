import { CommandId, MessageId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { SuperAgentStore } from "./SuperAgentStore.ts";
import type {
  ThreadManagementSendInput,
  ThreadManagementService,
} from "../orchestration-v2/ThreadManagementService.ts";

export const deliverNotices = Effect.fn("SuperAgent.deliverNotices")(function* (
  store: SuperAgentStore["Service"],
  threads: {
    readonly sendToThread: (
      input: ThreadManagementSendInput,
    ) => Effect.Effect<
      unknown,
      Effect.Error<ReturnType<ThreadManagementService["Service"]["sendToThread"]>>
    >;
  },
) {
  const state = yield* store.stored;
  if (!state.projectId || !state.threadId) return;
  for (const notice of state.notices) {
    yield* threads.sendToThread({
      projectId: state.projectId,
      threadId: state.threadId,
      commandId: CommandId.make(notice.id),
      messageId: MessageId.make(notice.id),
      text: notice.text,
      attachments: [],
      mode: "queue",
      createdBy: "user",
      creationSource: "web",
    });
    yield* store.acknowledgeNotice(notice.id);
  }
});
