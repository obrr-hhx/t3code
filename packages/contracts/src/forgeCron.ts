import * as Schema from "effect/Schema";

const Key = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(160));
const RequestId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
const Cursor = Schema.String.check(Schema.isMaxLength(512));
const Text = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(12_000));
const ScheduleInput = Schema.Struct({
  expression: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  prompt: Text,
  enabled: Schema.Boolean,
});
const Revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const ForgeCronQuery = Schema.Union([
  Schema.Struct({
    view: Schema.Literal("agentConversation"),
    cursor: Schema.optional(Cursor),
    turnId: Schema.optional(Key),
  }),
  Schema.Struct({ view: Schema.Literal("agentReceipt"), requestId: RequestId }),
  Schema.Struct({
    view: Schema.Literals(["list", "environments", "legacy"]),
    search: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
    cursor: Schema.optional(Cursor),
    includeArchived: Schema.optional(Schema.Boolean),
    limit: Schema.optional(
      Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 20 })),
    ),
  }),
  Schema.Struct({
    view: Schema.Literals(["detail", "wakeups", "results"]),
    sessionId: Key,
    cursor: Schema.optional(Cursor),
  }),
  Schema.Struct({
    view: Schema.Literal("preview"),
    expression: ScheduleInput.fields.expression,
    timezone: ScheduleInput.fields.timezone,
  }),
]);
export type ForgeCronQuery = typeof ForgeCronQuery.Type;
export const ForgeLegacySchedule = Schema.Struct({
  sessionId: Key,
  name: Schema.String,
  environmentId: Key,
  expression: Schema.String,
  timezone: Schema.String,
  scriptPath: Schema.String,
  enabled: Schema.Boolean,
  verifiedAt: Schema.String,
  evidenceRequestId: RequestId,
});
export const ForgeCronMutation = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("delegateLegacy"),
    requestId: RequestId,
    message: Text,
  }),
  Schema.Struct({ operation: Schema.Literal("trackLegacy"), record: ForgeLegacySchedule }),
  Schema.Struct({ operation: Schema.Literal("untrackLegacy"), sessionId: Key }),
  Schema.Struct({
    operation: Schema.Literal("create"),
    requestId: RequestId,
    environmentId: Key,
    agent: Schema.Literals(["claude", "codex"]),
    cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
    name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240)),
    initialPrompt: Text,
    schedule: ScheduleInput,
  }),
  Schema.Struct({
    operation: Schema.Literal("configure"),
    sessionId: Key,
    expectedRevision: Revision,
    schedule: ScheduleInput,
  }),
  Schema.Struct({
    operation: Schema.Literals(["pause", "resume", "retire"]),
    sessionId: Key,
    expectedRevision: Revision,
  }),
]);
export type ForgeCronMutation = typeof ForgeCronMutation.Type;
export const ForgeCronSchedule = Schema.Struct({
  expression: Schema.String,
  timezone: Schema.String,
  enabled: Schema.Boolean,
  schedulerEnabled: Schema.Boolean,
  nextRunAt: Schema.String,
  revision: Schema.Number,
});
export const ForgeCronSession = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  environmentId: Schema.String,
  phase: Schema.String,
  live: Schema.Boolean,
  agent: Schema.optional(Schema.String),
  attention: Schema.optional(Schema.String),
  cronRootId: Schema.optional(Schema.String),
  purpose: Schema.optional(Schema.String),
  progress: Schema.optional(Schema.String),
  updatedAt: Schema.String,
  closedAt: Schema.optional(Schema.String),
  archivedAt: Schema.optional(Schema.String),
  schedule: Schema.optional(ForgeCronSchedule),
});
export const ForgeCronWakeup = Schema.Struct({
  requestId: Schema.String,
  scheduledAt: Schema.String,
  state: Schema.String,
  outcome: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  completedAt: Schema.optional(Schema.String),
  resultEventId: Schema.optional(Schema.String),
});
export const ForgeCronEnvironment = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  status: Schema.String,
});
export const ForgeCronOutcome = Schema.Struct({
  eventId: Schema.String,
  sessionId: Schema.String,
  outcome: Schema.String,
  occurredAt: Schema.String,
  resultState: Schema.String,
  resultText: Schema.String,
});
export const ForgeCronResult = Schema.Struct({
  origin: Schema.String,
  actor: Schema.String,
  legacy: Schema.optional(Schema.Array(ForgeLegacySchedule)),
  agentState: Schema.optional(Schema.String),
  agentRequests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.String,
        text: Schema.String,
        questions: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            question: Schema.String,
            options: Schema.Array(Schema.String),
          }),
        ),
      }),
    ),
  ),
  receipt: Schema.optional(
    Schema.Struct({
      requestId: Schema.String,
      status: Schema.String,
      turnId: Schema.optional(Schema.String),
    }),
  ),
  messages: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        turnId: Schema.String,
        role: Schema.String,
        text: Schema.String,
        status: Schema.String,
      }),
    ),
  ),
  environments: Schema.optional(Schema.Array(ForgeCronEnvironment)),
  sessions: Schema.optional(Schema.Array(ForgeCronSession)),
  session: Schema.optional(ForgeCronSession),
  schedule: Schema.optional(Schema.NullOr(ForgeCronSchedule)),
  prompt: Schema.optional(Schema.String),
  results: Schema.optional(Schema.Array(ForgeCronOutcome)),
  wakeups: Schema.optional(Schema.Array(ForgeCronWakeup)),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
  nextRuns: Schema.optional(Schema.Array(Schema.String)),
  completedStages: Schema.optional(Schema.Array(Schema.String)),
  warning: Schema.optional(Schema.String),
});
export type ForgeCronResult = typeof ForgeCronResult.Type;
