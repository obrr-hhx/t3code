import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  SuperAgentQuery,
  SuperAgentMutation,
  SuperAgentSnapshot,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as McpSchema from "effect/ai/McpSchema";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as SuperAgent from "../../../superAgent/SuperAgentStore.ts";
const dependencies = [
  McpInvocationContext.McpInvocationContext,
  SuperAgent.SuperAgentStore,
  ThreadManagement.ThreadManagementService,
];
const read = Tool.make("super_agent_read", {
  description:
    "Read a bounded page of this manager's goals, decisions or collaboration memories. Use kind/search/cursor/limit; read id for details. Returns revision for optimistic edits. Available only inside Super Agent.",
  parameters: SuperAgentQuery,
  success: SuperAgentSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
const update = Tool.make("super_agent_update", {
  description:
    "Persist one goal, decision, memory or stable collaboration summary. Supply a stable requestId and the current expectedRevision. Reuse decision dedupeKey for the same question. Human answers cannot be fabricated or overwritten. Available only inside Super Agent.",
  parameters: SuperAgentMutation,
  success: SuperAgentSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
export const SuperAgentToolkit = Toolkit.make(read, update);
