import * as Effect from "effect/Effect";
import { SuperAgentError, type SuperAgentMutation } from "@t3tools/contracts";
import type { ThreadManagementService } from "../orchestration-v2/ThreadManagementService.ts";
import type { SuperAgentStore } from "./SuperAgentStore.ts";

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const textOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textOf).join("\n");
  if (value && typeof value === "object") return Object.values(value).map(textOf).join("\n");
  return String(value ?? "");
};
/** Only evidence read/execution results from the actual active manager run can attest a check. */
export const attestVerification = Effect.fn("SuperAgent.attestVerification")(function* (
  input: SuperAgentMutation,
  store: SuperAgentStore["Service"],
  threads: Pick<ThreadManagementService["Service"], "getThreadShell" | "getThreadRecords">,
) {
  if (input.operation.type !== "verify") return input;
  const op = input.operation;
  const state = yield* store.stored;
  if (!state.threadId || !state.records.some((g) => g.id === op.goalId && g.kind === "goal"))
    return yield* new SuperAgentError({ reason: "invalid" });
  const shell = yield* threads.getThreadShell(state.threadId);
  const runId = shell?.activeRunId;
  if (!runId) return yield* new SuperAgentError({ reason: "invalid" });
  const records = yield* threads.getThreadRecords(state.threadId, ["turnItems"], {
    turnItemRunIds: [runId],
    turnItemTypes: ["dynamic_tool", "command_execution"],
  });
  const quote = normalize(op.evidenceQuote);
  const candidates = records.turnItems.filter((item) => {
    if (item.runId !== runId || (item.status !== "completed" && item.status !== "failed"))
      return false;
    if (item.type === "dynamic_tool") {
      if (!item.toolName) return false;
      if (
        /super_agent_|t3_thread_(send|launch|list)|delegate_task|forge_cron_manage/.test(
          item.toolName,
        )
      )
        return false;
      if (item.status === "failed" && op.outcome !== "blocked") return false;
      return normalize(textOf(item.output)).includes(quote);
    }
    return (
      item.type === "command_execution" &&
      (item.exitCode === 0 ||
        ((item.exitCode === null || item.exitCode === undefined) && item.status === "completed") ||
        op.outcome === "blocked") &&
      normalize(textOf(item.output)).includes(quote)
    );
  });
  const source = candidates.at(-1);
  if (
    !source ||
    /(?:sk-[a-zA-Z0-9_-]{20,}|gh[pousr]_[a-zA-Z0-9]{20,}|Bearer\s+\S{16,})/.test(quote)
  )
    return yield* new SuperAgentError({ reason: "invalid" });
  return { ...input, operation: { ...op, runId, evidenceItemId: source.id } };
});
