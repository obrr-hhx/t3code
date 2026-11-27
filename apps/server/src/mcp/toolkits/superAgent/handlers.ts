import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import { attestVerification } from "../../../superAgent/verification.ts";
import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ForgeCron from "../../../superAgent/ForgeCron.ts";
import * as SuperAgent from "../../../superAgent/SuperAgentStore.ts";
import { SuperAgentToolkit } from "./tools.ts";
const manager = Effect.fn("SuperAgentMcp.manager")(function* () {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const service = yield* SuperAgent.SuperAgentStore;
  const state = yield* service.read({ limit: 1 });
  if (!state.threadId || scope.thread?.threadId !== state.threadId)
    return yield* new OrchestratorMcpFailure({
      code: "invalid_request",
      message: "Only the Super Agent thread can access manager records.",
    });
  return service;
});
export const layer = McpToolAccess.toLayer(SuperAgentToolkit, {
  forge_cron_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      yield* manager();
      return yield* (yield* ForgeCron.ForgeCron).read(input.query);
    }),
  ),
  forge_cron_manage: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      yield* manager();
      return yield* (yield* ForgeCron.ForgeCron).manage(input.change);
    }),
  ),
  super_agent_read: McpToolAccess.reads((input) =>
    Effect.gen(function* () {
      return yield* (yield* manager()).read(input);
    }),
  ),
  super_agent_update: McpToolAccess.writes((input) =>
    Effect.gen(function* () {
      const service = yield* manager();
      return yield* service
        .update(
          yield* attestVerification(input, service, yield* Threads.ThreadManagementService).pipe(
            Effect.mapError(
              () =>
                new OrchestratorMcpFailure({
                  code: "invalid_request",
                  message:
                    "Verification needs an exact quote from a completed evidence tool result in the current manager run. Dispatch receipts and manager records do not count.",
                }),
            ),
          ),
          "agent",
        )
        .pipe(
          Effect.mapError(
            (error) =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: error.message }),
          ),
        );
    }),
  ),
});
