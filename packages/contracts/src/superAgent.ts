import * as Schema from "effect/Schema";
import { EnvironmentId, ProjectId, ThreadId } from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
const Title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240));
const Text = Schema.String.check(Schema.isMaxLength(12_000));
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
  options: Schema.Array(Title).check(Schema.isMaxLength(12)),
  answer: Schema.NullOr(Text),
  updatedAt: Schema.String,
});
export type SuperAgentRecord = typeof SuperAgentRecord.Type;
export const SuperAgentQuery = Schema.Struct({
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
