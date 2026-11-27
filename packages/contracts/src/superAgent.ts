import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId, ThreadId, RunId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240));
const Text = Schema.String.check(Schema.isMaxLength(12_000));
const Blocker = Schema.Struct({
  kind: Schema.Literals(["external", "human", "access"]),
  condition: Title,
  owner: Title,
  continuation: Text,
});
const Verification = Schema.Struct({
  checkedAt: Schema.String,
  outcome: Schema.Literals(["unchanged", "progress", "completed", "blocked", "ready"]),
  summary: Title,
  evidenceQuote: Schema.String,
  evidenceItemId: Schema.String.check(Schema.isMaxLength(2048)),
  runId: RunId,
  fingerprint: Key,
  nextCheckAt: Schema.String,
});
export const SuperAgentRecord = Schema.Struct({
  id: Key,
  kind: Schema.Literals(["goal", "decision", "memory"]),
  title: Title,
  content: Text,
  status: Schema.Literals(["active", "blocked", "pending", "answered", "done", "archived"]),
  goalId: Schema.NullOr(Key),
  dedupeKey: Key,
  workerThreadId: Schema.NullOr(ThreadId),
  workerEnvironmentId: Schema.optional(EnvironmentId),
  forgeSessionId: Schema.optional(Key),
  blocker: Schema.optional(Blocker),
  verification: Schema.optional(Verification),
  options: Schema.Array(Title).check(Schema.isMaxLength(12)),
  answer: Schema.NullOr(Text),
  updatedAt: Schema.String,
});
export type SuperAgentRecord = typeof SuperAgentRecord.Type;
export const SuperAgentQuery = Schema.Struct({
  reportRunIds: Schema.optional(Schema.Array(RunId).check(Schema.isMaxLength(100))),
  kind: Schema.optional(Schema.Literals(["goal", "decision", "memory"])),
  search: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
  id: Schema.optional(Key),
  includeCompleted: Schema.optional(Schema.Boolean),
  cursor: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  limit: Schema.optional(
    Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 })),
  ),
});
export type SuperAgentQuery = typeof SuperAgentQuery.Type;
export const SuperAgentSnapshot = Schema.Struct({
  storageAvailable: Schema.Boolean,
  pendingDeliveries: Schema.Number,
  nextCheckAt: Schema.NullOr(Schema.Number),
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  revision: Schema.Number,
  summary: Schema.String,
  records: Schema.Array(SuperAgentRecord),
  total: Schema.Number,
  nextCursor: Schema.NullOr(Schema.Number),
  reportPolicyAt: Schema.optional(Schema.String),
  reportRunIds: Schema.optional(Schema.Array(RunId)),
  pendingVerificationIds: Schema.optional(Schema.Array(Key)),
});
export type SuperAgentSnapshot = typeof SuperAgentSnapshot.Type;
export const SuperAgentMutation = Schema.Struct({
  requestId: Key,
  expectedRevision: Schema.Number,
  operation: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("plan"),
      afterMinutes: Schema.NullOr(
        Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10080 })),
      ),
    }),
    Schema.Struct({
      type: Schema.Literal("verify"),
      goalId: Key,
      outcome: Schema.Literals(["unchanged", "progress", "completed", "blocked", "ready"]),
      summary: Title,
      evidenceQuote: Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(1200)),
      afterMinutes: Schema.Number.check(Schema.isBetween({ minimum: 1, maximum: 10080 })),
      report: Schema.NullOr(Schema.Literals(["milestone", "completion", "failure", "decision"])),
      // Filled and checked against this manager's actual current run by the server.
      runId: Schema.optional(RunId),
      evidenceItemId: Schema.optional(Schema.String.check(Schema.isMaxLength(2048))),
    }),
    Schema.Struct({ type: Schema.Literal("upsert"), record: SuperAgentRecord }),
    Schema.Struct({ type: Schema.Literal("delete"), id: Key }),
    Schema.Struct({ type: Schema.Literal("answer"), id: Key, answer: Text }),
    Schema.Struct({
      type: Schema.Literal("summary"),
      text: Schema.String.check(Schema.isMaxLength(4_000)),
    }),
  ]),
});
export type SuperAgentMutation = typeof SuperAgentMutation.Type;
export const SuperAgentEnsureInput = Schema.Struct({
  modelSelection: Schema.optional(ModelSelection),
});
export type SuperAgentEnsureInput = typeof SuperAgentEnsureInput.Type;
export class SuperAgentError extends Schema.TaggedError<SuperAgentError>()("SuperAgentError", {
  reason: Schema.Literals(["storage", "conflict", "invalid", "unavailable", "not_manager"]),
}) {
  override get message(): string {
    switch (this.reason) {
      case "conflict":
        return "The manager state changed. Refresh before editing.";
      case "invalid":
        return "This manager change is not valid.";
      case "unavailable":
        return "Super Agent could not start. Check the configured coding provider.";
      case "not_manager":
        return "Only the Super Agent conversation can manage this workspace.";
      case "storage":
        return "Super Agent state could not be saved. No change was accepted.";
    }
  }
}
