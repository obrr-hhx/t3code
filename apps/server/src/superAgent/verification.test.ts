import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProjectId, ThreadId, RunId, type SuperAgentMutation } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Config from "../config.ts";
import * as Store from "./SuperAgentStore.ts";
import { attestVerification } from "./verification.ts";
import { deliverContinuations } from "./continuations.ts";

it.layer(NodeServices.layer)("verified goal lifecycle", (it) => {
  it.effect(
    "rejects missing, stale and dispatch evidence; attests a real result, resumes exactly once and deduplicates reports",
    () =>
      Effect.gen(function* () {
        const config = yield* Config.layerTest(process.cwd(), { prefix: "goal-proof-e2e-" }).pipe(
          Layer.build,
        );
        const store = yield* Store.SuperAgentStore.pipe(
          Effect.provide(Store.layer.pipe(Layer.provide(Layer.succeedContext(config)))),
        );
        yield* store.bind(ProjectId.make("manager-project"), ThreadId.make("manager"));
        const goal = {
          id: "rollout",
          kind: "goal" as const,
          title: "External rollout",
          content: "Existing authorized rollout task",
          status: "blocked" as const,
          goalId: null,
          dedupeKey: "rollout",
          workerThreadId: ThreadId.make("worker"),
          options: [],
          answer: null,
          updatedAt: "2026-01-01T00:00:00Z",
          blocker: {
            kind: "external" as const,
            condition: "Approved release is healthy",
            owner: "Infra",
            continuation: "Continue the already-authorized acceptance checks.",
          },
        };
        yield* store.update(
          { requestId: "goal", expectedRevision: 1, operation: { type: "upsert", record: goal } },
          "agent",
        );
        const quote = "PR #12 approved; deployment ready 3/3; health checks passed";
        const input: SuperAgentMutation = {
          requestId: "verify",
          expectedRevision: 2,
          operation: {
            type: "verify",
            goalId: "rollout",
            outcome: "ready",
            summary: "External condition confirmed",
            evidenceQuote: quote,
            afterMinutes: 15,
            report: "milestone",
          },
        };
        let items: unknown[] = [];
        const sends: string[] = [];
        const threads = {
          getThreadShell: (id: ThreadId) =>
            Effect.succeed({
              id,
              projectId: ProjectId.make("project"),
              activeRunId: RunId.make("current"),
              archivedAt: null,
              deletedAt: null,
            }) as never,
          getThreadRecords: () => Effect.succeed({ turnItems: items }) as never,
          sendToThread: (send: { commandId: string }) =>
            Effect.sync(() => {
              sends.push(send.commandId);
            }) as never,
        };
        expect(yield* attestVerification(input, store, threads).pipe(Effect.flip)).toBeDefined();
        items = [
          {
            id: "send",
            runId: "current",
            type: "dynamic_tool",
            status: "completed",
            toolName: "t3_thread_send",
            output: quote,
          },
        ];
        expect(yield* attestVerification(input, store, threads).pipe(Effect.flip)).toBeDefined();
        items = [
          {
            id: "old",
            runId: "previous",
            type: "command_execution",
            status: "completed",
            exitCode: 0,
            output: quote,
          },
        ];
        expect(yield* attestVerification(input, store, threads).pipe(Effect.flip)).toBeDefined();
        expect((yield* store.read({ id: "rollout" })).records[0]?.verification).toBeUndefined();
        items = [
          {
            id: "read",
            runId: "current",
            type: "command_execution",
            status: "completed",
            exitCode: 0,
            output: quote,
          },
        ];
        const checked = yield* attestVerification(input, store, threads);
        yield* store.update(checked, "agent");
        const snapshot = yield* store.read({ id: "rollout" });
        expect(snapshot.records[0]?.verification?.evidenceItemId).toBe("read");
        expect(snapshot.records[0]?.status).toBe("blocked");
        expect(snapshot.reportRunIds).toEqual(["current"]);
        expect((yield* store.stored).continuations).toHaveLength(1);
        const peers = { call: () => Effect.die("Local continuation must not use a peer") };
        yield* deliverContinuations(store, threads, peers);
        yield* deliverContinuations(store, threads, peers);
        expect(sends).toHaveLength(1);
        expect((yield* store.read({ id: "rollout" })).records[0]?.status).toBe("active");
        const repeat = {
          ...checked,
          requestId: "recheck",
          expectedRevision: (yield* store.stored).revision,
        };
        yield* store.update(repeat, "agent");
        expect((yield* store.stored).continuations).toHaveLength(0);
        expect((yield* store.read({})).reportRunIds).toHaveLength(1);
      }),
  );
});
