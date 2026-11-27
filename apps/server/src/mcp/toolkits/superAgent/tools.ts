import * as Schema from "effect/Schema";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import {
  SuperAgentQuery,
  SuperAgentMutation,
  SuperAgentSnapshot,
  OrchestratorMcpFailure,
  ForgeCronQuery,
  ForgeCronMutation,
  ForgeCronResult,
} from "@t3tools/contracts";
import * as Tool from "effect/ai/Tool";
import * as Toolkit from "effect/ai/Toolkit";
import * as McpSchema from "effect/ai/McpSchema";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ForgeCron from "../../../superAgent/ForgeCron.ts";
import * as SuperAgent from "../../../superAgent/SuperAgentStore.ts";
const dependencies = [
  McpInvocationContext.McpInvocationContext,
  SuperAgent.SuperAgentStore,
  ForgeCron.ForgeCron,
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
    "Persist goals, blockers, decisions, memory or summary. operation verify requires an exact evidenceQuote from a completed evidence read in the current manager run, outcome and afterMinutes; dispatch receipts cannot verify. report=null stays silent; new milestone/completion/failure/decision reports are deduplicated. ready resumes an external blocker through the original worker. Supply a stable requestId and the current expectedRevision. Reuse decision dedupeKey for the same question. Human answers cannot be fabricated or overwritten. Available only inside Super Agent.",
  parameters: SuperAgentMutation,
  success: SuperAgentSnapshot,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
const cronRead = Tool.make("forge_cron_read", {
  description:
    "Read native Forge cron families with bounded list/search/cursor pages, schedule detail, wakeup receipts, result summaries, VM inventory or timezone-aware preview. Legacy lists tracked VM crontab/systemd plans separately. agentConversation/agentReceipt inspect Forge Agent delegation. Uses this host's existing forgectl identity, returned as actor and origin. Only Super Agent. Delivery is not completion; live=false may mean VM unavailable.",
  parameters: Schema.Struct({ query: ForgeCronQuery }),
  success: ForgeCronResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
const cronManage = Tool.make("forge_cron_manage", {
  description:
    "Manage native Forge cron sessions within the user's mandate. Create immediately starts initialPrompt on the specified VM, then saves schedule; keep its UUID requestId stable. Configure/pause/resume/retire require the last-read schedule revision (0 if absent). Pause leaves current work running. Retire pauses, closes only this session, then archives with history retained; never deletes a VM. Inspect completedStages and warning: partial/unknown delivery is not success and must not be blindly retried. trackLegacy/untrackLegacy edit inventory only. delegateLegacy sends a task to the existing Forge Agent to inspect or manage a VM-local schedule; preserve the user’s scope, follow its receipt to the actual result, and do not duplicate an existing VM schedule with native cron. Only Super Agent.",
  parameters: Schema.Struct({ change: ForgeCronMutation }),
  success: ForgeCronResult,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies,
})
  .annotate(Tool.Destructive, true)
  .annotate(McpSchema.EnabledWhen, McpInvocationContext.hiddenFromOutsideClients);
export const SuperAgentToolkit = Toolkit.make(read, update, cronRead, cronManage);
