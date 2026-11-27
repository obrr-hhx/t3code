import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as Config from "../config.ts";
import * as Store from "./SuperAgentStore.ts";
import { deliverNotices } from "./delivery.ts";
import {
  ThreadManagementThreadNotFoundError,
  type ThreadManagementSendInput,
} from "../orchestration-v2/ThreadManagementService.ts";

it.layer(NodeServices.layer)("Super Agent persistence", (it) => {
  it.effect(
    "retains undelivered goals across restart and reuses the native command after a failed send",
    () =>
      Effect.gen(function* () {
        const config = yield* Config.layerTest(process.cwd(), { prefix: "t3-manager-test-" }).pipe(
          Layer.build,
        );
        const configLayer = Layer.succeedContext(config);
        const storeLayer = Store.layer.pipe(Layer.provide(configLayer));
        const first = yield* Store.SuperAgentStore.pipe(Effect.provide(storeLayer));
        yield* first.bind(ProjectId.make("project"), ThreadId.make("manager"));
        yield* first.update(
          {
            requestId: "goal-request",
            expectedRevision: 1,
            operation: {
              type: "upsert",
              record: {
                id: "goal",
                kind: "goal",
                title: "Investigate failing tests",
                content: "Continue the existing worker.",
                status: "active",
                goalId: null,
                dedupeKey: "tests",
                workerThreadId: null,
                options: [],
                answer: null,
                updatedAt: "2026-01-01T00:00:00Z",
              },
            },
          },
          "user",
        );
        const commands: string[] = [];
        const failing = {
          sendToThread: (input: ThreadManagementSendInput) => {
            commands.push(input.commandId);
            return Effect.fail(
              new ThreadManagementThreadNotFoundError({
                projectId: ProjectId.make("project"),
                threadId: ThreadId.make("manager"),
              }),
            );
          },
        };
        yield* deliverNotices(first, failing).pipe(Effect.flip);
        assert.strictEqual((yield* first.read({})).pendingDeliveries, 1);
        const second = yield* Store.SuperAgentStore.pipe(Effect.provide(storeLayer));
        assert.strictEqual((yield* second.read({})).records[0]?.title, "Investigate failing tests");
        const success = {
          sendToThread: (input: ThreadManagementSendInput) => {
            commands.push(input.commandId);
            return Effect.void;
          },
        };
        yield* deliverNotices(second, success);
        assert.deepStrictEqual(commands, [
          "super-agent-notice:goal-request",
          "super-agent-notice:goal-request",
        ]);
        assert.strictEqual((yield* second.read({})).pendingDeliveries, 0);
        const third = yield* Store.SuperAgentStore.pipe(Effect.provide(storeLayer));
        assert.strictEqual((yield* third.read({})).pendingDeliveries, 0);
      }),
  );
  it.effect("does not accept an update when the atomic replacement fails", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const configLayer = Layer.succeedContext(
        yield* Config.layerTest(process.cwd(), { prefix: "t3-manager-failure-" }).pipe(Layer.build),
      );
      const brokenFs = {
        ...fs,
        rename: (from: string) =>
          Effect.fail(
            PlatformError.systemError({
              _tag: "PermissionDenied",
              module: "FileSystem",
              method: "rename",
              pathOrDescriptor: from,
            }),
          ),
      };
      const store = yield* Store.SuperAgentStore.pipe(
        Effect.provide(
          Store.layer.pipe(
            Layer.provide(configLayer),
            Layer.provide(Layer.succeed(FileSystem.FileSystem, brokenFs)),
          ),
        ),
      );
      const error = yield* store
        .update(
          {
            requestId: "summary",
            expectedRevision: 0,
            operation: { type: "summary", text: "Keep existing sessions." },
          },
          "user",
        )
        .pipe(Effect.flip);
      assert.strictEqual(error.reason, "storage");
      assert.strictEqual((yield* store.read({ kind: "memory" })).summary, "");
    }),
  );
  it.effect(
    "preserves malformed storage and refuses writes without preventing the host from starting",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* Config.ServerConfig.pipe(
          Effect.provide(Config.layerTest(process.cwd(), { prefix: "t3-manager-corrupt-" })),
        );
        const file = `${config.stateDir}/super-agent/state.json`;
        yield* fs.makeDirectory(`${config.stateDir}/super-agent`, { recursive: true });
        yield* fs.writeFileString(file, "malformed original record");
        const store = yield* Store.SuperAgentStore.pipe(
          Effect.provide(
            Store.layer.pipe(Layer.provide(Layer.succeed(Config.ServerConfig, config))),
          ),
        );
        assert.strictEqual((yield* store.read({})).storageAvailable, false);
        const error = yield* store
          .update(
            {
              requestId: "must-not-overwrite",
              expectedRevision: 0,
              operation: { type: "summary", text: "New memory" },
            },
            "user",
          )
          .pipe(Effect.flip);
        assert.strictEqual(error.reason, "storage");
        assert.strictEqual(yield* fs.readFileString(file), "malformed original record");
      }),
  );
  it.effect("does not let an older background observation overwrite a user's new check plan", () =>
    Effect.gen(function* () {
      const config = yield* Config.layerTest(process.cwd(), { prefix: "t3-manager-plan-" }).pipe(
        Layer.build,
      );
      const store = yield* Store.SuperAgentStore.pipe(
        Effect.provide(Store.layer.pipe(Layer.provide(Layer.succeedContext(config)))),
      );
      const old = yield* store.stored;
      yield* store.update(
        {
          requestId: "pause",
          expectedRevision: 0,
          operation: { type: "plan", afterMinutes: null },
        },
        "user",
      );
      assert.strictEqual(
        yield* store.recordObservation({ ...old.observation, nextCheckAt: 1000 }, old.observation),
        false,
      );
      assert.strictEqual((yield* store.read({})).nextCheckAt, null);
    }),
  );
  it.effect(
    "loads old observation records and persists the unfinished review queue across restart",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const config = yield* Config.ServerConfig.pipe(
          Effect.provide(Config.layerTest(process.cwd(), { prefix: "t3-review-migration-" })),
        );
        const file = `${config.stateDir}/super-agent/state.json`;
        yield* fs.makeDirectory(`${config.stateDir}/super-agent`, { recursive: true });
        yield* fs.writeFileString(
          file,
          JSON.stringify({
            version: 1,
            threadId: null,
            projectId: null,
            revision: 0,
            summary: "",
            records: [],
            receipts: [],
            observation: {
              generation: 0,
              signature: null,
              lastStall: null,
              nextCheckAt: null,
              pending: null,
            },
          }),
        );
        const layer = Store.layer.pipe(Layer.provide(Layer.succeed(Config.ServerConfig, config)));
        const first = yield* Store.SuperAgentStore.pipe(Effect.provide(layer));
        const old = yield* first.stored;
        assert.strictEqual(old.observation.paused, false);
        assert.deepStrictEqual(old.observation.reviewQueue, []);
        yield* first.recordObservation({
          ...old.observation,
          reviewQueue: ["goal-11", "goal-12"],
          nextCheckAt: 1800000,
          pending: { id: "stable-request", text: "Goal batch" },
        });
        const second = yield* Store.SuperAgentStore.pipe(Effect.provide(layer));
        assert.deepStrictEqual((yield* second.stored).observation.reviewQueue, [
          "goal-11",
          "goal-12",
        ]);
        assert.strictEqual((yield* second.stored).observation.pending?.id, "stable-request");
      }),
  );
});
