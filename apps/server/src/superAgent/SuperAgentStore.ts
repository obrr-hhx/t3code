import type { ObservationState } from "./observations.ts";
import * as DateTime from "effect/DateTime";
import {
  EnvironmentId,
  RunId,
  ProjectId,
  ThreadId,
  SuperAgentError,
  SuperAgentRecord,
  type SuperAgentMutation,
  type SuperAgentQuery,
  type SuperAgentSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ServerConfig from "../config.ts";
import { changeState, emptyState, queryState, type State } from "./state.ts";
import { SUPER_AGENT_INSTRUCTIONS } from "./prompt.ts";
const StoredState = Schema.Struct({
  reportPolicyAt: Schema.NullOr(Schema.String).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null)),
  ),
  reportRunIds: Schema.Array(RunId).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  continuations: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      goalId: Schema.String,
      threadId: ThreadId,
      environmentId: Schema.optional(EnvironmentId),
      text: Schema.String,
    }),
  ).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  notices: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String })).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  observation: Schema.Struct({
    inFlight: Schema.NullOr(
      Schema.Struct({
        id: Schema.String,
        goalIds: Schema.Array(Schema.String),
        issuedAt: Schema.Number,
        retryAt: Schema.Number,
        attempt: Schema.Number,
      }),
    ).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
    paused: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
    reviewQueue: Schema.Array(Schema.String).pipe(
      Schema.withDecodingDefaultKey(Effect.succeed([])),
    ),
    generation: Schema.Number.pipe(Schema.withDecodingDefaultKey(Effect.succeed(0))),
    signature: Schema.NullOr(Schema.String),
    lastStall: Schema.NullOr(Schema.String),
    nextCheckAt: Schema.NullOr(Schema.Number),
    pending: Schema.NullOr(Schema.Struct({ id: Schema.String, text: Schema.String })),
  }),
  version: Schema.Literal(1),
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  revision: Schema.Number,
  summary: Schema.String,
  records: Schema.Array(SuperAgentRecord),
  receipts: Schema.Array(Schema.Struct({ id: Schema.String, payload: Schema.String })),
});

const decodeStoredState = Schema.decodeEffect(Schema.fromJsonString(StoredState));
const encodeStoredState = Schema.encodeEffect(Schema.fromJsonString(StoredState));
const isSuperAgentError = Schema.is(SuperAgentError);

export class SuperAgentStore extends Context.Service<
  SuperAgentStore,
  {
    readonly read: (query: SuperAgentQuery) => Effect.Effect<SuperAgentSnapshot>;
    readonly stored: Effect.Effect<State>;
    readonly recordObservation: (
      value: ObservationState,
      expected?: ObservationState,
    ) => Effect.Effect<boolean, SuperAgentError>;
    readonly acknowledgeContinuation: (id: string) => Effect.Effect<void, SuperAgentError>;
    readonly acknowledgeNotice: (id: string) => Effect.Effect<void, SuperAgentError>;
    readonly workspace: string;
    readonly syncMemory: Effect.Effect<void, SuperAgentError>;
    readonly bind: (
      projectId: ProjectId,
      threadId: ThreadId,
    ) => Effect.Effect<void, SuperAgentError>;
    readonly update: (
      input: SuperAgentMutation,
      actor: "user" | "agent",
    ) => Effect.Effect<SuperAgentSnapshot, SuperAgentError>;
    readonly subscribe: (query: SuperAgentQuery) => Stream.Stream<SuperAgentSnapshot>;
  }
>()("t3/superAgent/SuperAgentStore") {}
const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const changes = yield* PubSub.sliding<void>(1);
  const folder = path.join(config.stateDir, "super-agent");
  const workspace = path.join(folder, "workspace");
  const file = path.join(folder, "state.json");
  yield* fs.makeDirectory(workspace, { recursive: true });
  const exists = yield* fs.exists(file);
  const loaded = yield* (
    exists
      ? fs.readFileString(file).pipe(Effect.flatMap(decodeStoredState))
      : Effect.succeed(emptyState())
  ).pipe(Effect.result);
  const storageAvailable = loaded._tag === "Success";
  let state: State = loaded._tag === "Success" ? loaded.success : emptyState();
  let memoryDirty = true;
  const save = Effect.fn("SuperAgentService.save")(function* (next: State) {
    if (!storageAvailable) return yield* new SuperAgentError({ reason: "storage" });
    yield* fs.writeFileString(file + ".tmp", yield* encodeStoredState(next), { mode: 0o600 });
    yield* fs.rename(file + ".tmp", file);
    state = next;
    yield* PubSub.publish(changes, undefined);
  });
  if (storageAvailable && state.reportPolicyAt === null) {
    state = { ...state, reportPolicyAt: DateTime.formatIso(yield* DateTime.now) };
    yield* save(state).pipe(
      Effect.catch(() =>
        Effect.logWarning(
          "Manager report policy is active in memory; durable saving will be retried by the next update.",
        ),
      ),
    );
  }
  const syncMemory = Effect.fn("SuperAgentStore.syncMemory")(function* () {
    if (!storageAvailable) return yield* new SuperAgentError({ reason: "storage" });
    if (!memoryDirty) return;
    yield* fs.writeFileString(
      path.join(workspace, "AGENTS.md"),
      SUPER_AGENT_INSTRUCTIONS + state.summary + "\n",
    );
    yield* fs.writeFileString(path.join(workspace, "CLAUDE.md"), "@AGENTS.md\n");
    const memories = state.records.filter((r) => r.kind === "memory" && r.status !== "archived");
    yield* fs.writeFileString(
      path.join(workspace, "COLLABORATION_MEMORY.md"),
      memories.map((r) => `## ${r.title}\n${r.content}\n`).join("\n"),
    );
    memoryDirty = false;
  });
  const read = Effect.fn("SuperAgentStore.read")((query: SuperAgentQuery) =>
    Effect.sync(() => ({ ...queryState(state, query), storageAvailable })),
  );
  const update = Effect.fn("SuperAgentService.update")(
    function* (input: SuperAgentMutation, actor: "user" | "agent") {
      const now = DateTime.formatIso(yield* DateTime.now);
      const next = yield* Effect.try({
        try: () => changeState(state, input, actor, now),
        catch: (error) =>
          isSuperAgentError(error) ? error : new SuperAgentError({ reason: "invalid" }),
      });
      if (next !== state) {
        yield* save(next);
      }
      if (
        input.operation.type === "summary" ||
        (input.operation.type === "upsert" && input.operation.record.kind === "memory") ||
        input.operation.type === "delete"
      ) {
        memoryDirty = true;
        yield* syncMemory().pipe(
          Effect.catch(() =>
            Effect.logWarning(
              "Manager memory was saved; refreshing its instruction files will retry.",
            ),
          ),
        );
      }
      return queryState(state, {});
    },
    Effect.mapError((error) =>
      isSuperAgentError(error) ? error : new SuperAgentError({ reason: "storage" }),
    ),
  );
  const bind = Effect.fn("SuperAgentStore.bind")((projectId: ProjectId, threadId: ThreadId) =>
    lock
      .withPermits(1)(
        Effect.suspend(() => save({ ...state, projectId, threadId, revision: state.revision + 1 })),
      )
      .pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
  );
  const updateLocked = Effect.fn("SuperAgentStore.updateLocked")(
    (input: SuperAgentMutation, actor: "user" | "agent") =>
      lock.withPermits(1)(update(input, actor)),
  );
  const recordObservation = Effect.fn("SuperAgentStore.recordObservation")(
    (value: ObservationState, expected?: ObservationState) =>
      lock
        .withPermits(1)(
          Effect.gen(function* () {
            if (expected && state.observation !== expected) return false;
            yield* save({ ...state, observation: value });
            return true;
          }),
        )
        .pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
  );
  const acknowledgeNotice = Effect.fn("SuperAgentStore.acknowledgeNotice")((id: string) =>
    lock
      .withPermits(1)(
        Effect.suspend(() => save({ ...state, notices: state.notices.filter((n) => n.id !== id) })),
      )
      .pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
  );
  return SuperAgentStore.of({
    read,
    recordObservation,
    acknowledgeNotice,
    acknowledgeContinuation: Effect.fn("SuperAgentStore.acknowledgeContinuation")((id) =>
      lock
        .withPermits(1)(
          Effect.suspend(() =>
            save({
              ...state,
              revision: state.revision + 1,
              records: state.records.map((g) =>
                state.continuations.some((c) => c.id === id && c.goalId === g.id) &&
                g.status === "blocked"
                  ? { ...g, status: "active" as const }
                  : g,
              ),
              continuations: state.continuations.filter((c) => c.id !== id),
            }),
          ),
        )
        .pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
    ),
    stored: Effect.sync(() => state),
    workspace,
    bind,
    update: updateLocked,
    syncMemory: lock
      .withPermits(1)(syncMemory())
      .pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
    subscribe: (query) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const sub = yield* PubSub.subscribe(changes);
          return Stream.concat(
            Stream.fromEffect(read(query)),
            Stream.fromSubscription(sub).pipe(Stream.mapEffect(() => read(query))),
          );
        }),
      ),
  });
});
export const layer: Layer.Layer<
  SuperAgentStore,
  SuperAgentError,
  FileSystem.FileSystem | Path.Path | ServerConfig.ServerConfig
> = Layer.effect(
  SuperAgentStore,
  make.pipe(Effect.mapError(() => new SuperAgentError({ reason: "storage" }))),
);
