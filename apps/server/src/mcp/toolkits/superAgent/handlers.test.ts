import * as ForgeCron from "../../../superAgent/ForgeCron.ts";
import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Scope from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import * as Store from "../../../superAgent/SuperAgentStore.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import { emptyState, queryState } from "../../../superAgent/state.ts";
import * as Handlers from "./handlers.ts";
import { SuperAgentToolkit } from "./tools.ts";

it.effect.each(["manager", "worker"])(
  "allows manager reads only in the manager conversation (%s)",
  (caller) => {
    const id = ThreadId.make(caller);
    const snapshot = queryState({ ...emptyState(), threadId: ThreadId.make("manager") }, {});
    let cronCalls = 0;
    const dependencies = Layer.mergeAll(
      Layer.mock(ForgeCron.ForgeCron)({
        read: () =>
          Effect.sync(() => {
            cronCalls++;
            return { origin: "https://forge.example", actor: "user@example.com", sessions: [] };
          }),
      }),
      Layer.succeed(Scope.McpInvocationContext, {
        environmentId: EnvironmentId.make("test"),
        requestNamespace: "test",
        issuedAt: 0,
        capabilities: new Set(["orchestration" as const]),
        client: undefined,
        thread: {
          threadId: id,
          providerSessionId: "test",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
      }),
      Layer.mock(Threads.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(id)),
      }),
      Layer.mock(Store.SuperAgentStore)({
        workspace: "/test/manager",
        read: () => Effect.succeed(snapshot),
      }),
    );
    return Effect.gen(function* () {
      const toolkit = yield* SuperAgentToolkit;
      const result = yield* toolkit
        .handle("super_agent_read", {})
        .pipe(Stream.unwrap, Stream.runCollect);
      if (caller === "manager")
        expect(result.at(-1)?.result).toMatchObject({ threadId: "manager", revision: 0 });
      else expect(result.at(-1)?.result).toMatchObject({ code: "invalid_request" });
      const cron = yield* toolkit
        .handle("forge_cron_read", { query: { view: "list" } })
        .pipe(Stream.unwrap, Stream.runCollect);
      expect(cronCalls).toBe(caller === "manager" ? 1 : 0);
      if (caller === "worker")
        expect(cron.at(-1)?.result).toMatchObject({ code: "invalid_request" });
    }).pipe(
      Effect.provide(
        Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provideMerge(dependencies)),
      ),
    );
  },
);
