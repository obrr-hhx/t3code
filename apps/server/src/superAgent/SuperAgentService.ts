import { attestVerification } from "./verification.ts";
import * as Clock from "effect/Clock";
import {
  CommandId,
  ProjectId,
  ThreadId,
  MessageId,
  SuperAgentError,
  type SuperAgentEnsureInput,
  type SuperAgentMutation,
  type SuperAgentQuery,
  type SuperAgentSnapshot,
  isProviderAvailable,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type * as Stream from "effect/Stream";
import * as ProjectService from "../project/ProjectService.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Store from "./SuperAgentStore.ts";
import { deliverNotices } from "./delivery.ts";
export class SuperAgentService extends Context.Service<
  SuperAgentService,
  {
    readonly read: (query: SuperAgentQuery) => Effect.Effect<SuperAgentSnapshot>;
    readonly subscribe: (query: SuperAgentQuery) => Stream.Stream<SuperAgentSnapshot>;
    readonly ensure: (
      input: SuperAgentEnsureInput,
    ) => Effect.Effect<SuperAgentSnapshot, SuperAgentError>;
    readonly update: (
      input: SuperAgentMutation,
      actor: "user" | "agent",
    ) => Effect.Effect<SuperAgentSnapshot, SuperAgentError>;
    readonly review: () => Effect.Effect<void, SuperAgentError>;
  }
>()("t3/superAgent/SuperAgentService") {}

const isSuperAgentError = Schema.is(SuperAgentError);
const make = Effect.gen(function* () {
  const store = yield* Store.SuperAgentStore;
  const projects = yield* ProjectService.ProjectService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launch = yield* ThreadLaunchService.ThreadLaunchService;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const lock = yield* Semaphore.make(1);
  const ensure = Effect.fn("SuperAgentService.ensure")(
    function* (input: SuperAgentEnsureInput) {
      const state = yield* store.stored;
      if (state.threadId) {
        const existing = yield* threads.getThreadShell(state.threadId);
        if (!existing || existing.archivedAt || existing.deletedAt)
          return yield* new SuperAgentError({ reason: "unavailable" });
        return yield* store.read({});
      }
      const catalog = yield* providers.getProviders;
      const provider =
        catalog.find((p) => p.driver === "codex" && isProviderAvailable(p)) ??
        catalog.find(isProviderAvailable);
      const model = provider?.models.find((m) => m.isDefault) ?? provider?.models[0];
      const selection =
        input.modelSelection ??
        (provider && model ? { instanceId: provider.instanceId, model: model.slug } : null);
      if (!selection) return yield* new SuperAgentError({ reason: "unavailable" });
      const projectId = ProjectId.make("super-agent-project"),
        threadId = ThreadId.make("super-agent-manager");
      yield* store.syncMemory;
      yield* projects.bootstrap({
        commandId: CommandId.make("super-agent-project-bootstrap"),
        projectId,
        title: "Super Agent",
        workspaceRoot: store.workspace,
        createWorkspaceRootIfMissing: true,
        defaultModelSelection: selection,
      });
      yield* launch.launch({
        commandId: CommandId.make("super-agent-thread-bootstrap"),
        projectId,
        threadId,
        title: "Super Agent",
        titleRenamed: true,
        modelSelection: selection,
        reuseExistingThread: false,
        workspaceStrategy: { type: "root" },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdBy: "user",
        creationSource: "web",
      });
      yield* store.bind(projectId, threadId);
      const bound = yield* store.stored;
      yield* store.recordObservation({
        ...bound.observation,
        nextCheckAt: (yield* Clock.currentTimeMillis) + 5 * 60000,
      });
      return yield* store.read({});
    },

    Effect.mapError(() => new SuperAgentError({ reason: "unavailable" })),
  );
  const update = Effect.fn("SuperAgentService.update")(
    function* (input: SuperAgentMutation, actor: "user" | "agent") {
      yield* store.update(yield* attestVerification(input, store, threads), actor);
      yield* deliverNotices(store, threads).pipe(
        Effect.catch(() =>
          Effect.logWarning("Super Agent delivery deferred; the saved request will be retried."),
        ),
      );
      return yield* store.read({});
    },
    Effect.mapError((error) =>
      isSuperAgentError(error) ? error : new SuperAgentError({ reason: "unavailable" }),
    ),
  );
  const review = Effect.fn("SuperAgentService.review")(
    function* () {
      const state = yield* store.stored;
      if (!state.threadId || !state.projectId)
        return yield* new SuperAgentError({ reason: "unavailable" });
      const id = `super-agent-review:${yield* Clock.currentTimeMillis}`;
      yield* threads.sendToThread({
        projectId: state.projectId,
        threadId: state.threadId,
        commandId: CommandId.make(id),
        messageId: MessageId.make(id),
        text: "检查所有本地及已连接远程会话，核对目标的实际进展，向我同步重要变化和需要我处理的事项。",
        attachments: [],
        mode: "queue",
        createdBy: "user",
        creationSource: "web",
      });
    },
    Effect.mapError(() => new SuperAgentError({ reason: "unavailable" })),
  );
  const ensureLocked = Effect.fn("SuperAgentService.ensureLocked")((input: SuperAgentEnsureInput) =>
    lock.withPermits(1)(ensure(input)),
  );
  return SuperAgentService.of({
    read: store.read,
    subscribe: store.subscribe,
    ensure: ensureLocked,
    update,
    review,
  });
});
export const layer: Layer.Layer<
  SuperAgentService,
  SuperAgentError,
  | import("effect/FileSystem").FileSystem
  | import("effect/Path").Path
  | import("../config.ts").ServerConfig
  | ProjectService.ProjectService
  | ThreadLaunchService.ThreadLaunchService
  | ThreadManagementService.ThreadManagementService
  | ProviderRegistry.ProviderRegistry
  | Store.SuperAgentStore
> = Layer.effect(SuperAgentService, make);
