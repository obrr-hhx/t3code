import {
  ForgeCronQuery,
  ForgeCronMutation,
  ForgeCronResult,
  ForgeCronSchedule,
  ForgeCronSession,
  ForgeCronWakeup,
  ForgeCronOutcome,
  ForgeCronEnvironment,
  ForgeLegacySchedule,
  OrchestratorMcpFailure,
} from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Redacted from "effect/Redacted";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import YAML from "yaml";
import type { WorkerObservation } from "./observations.ts";

const Settings = Schema.Struct({ server: Schema.String, api_key: Schema.String });
const FullSchedule = Schema.Struct({ ...ForgeCronSchedule.fields, prompt: Schema.String });
const SessionPage = Schema.Struct({
  items: Schema.Array(ForgeCronSession),
  pageInfo: Schema.Struct({
    hasNextPage: Schema.Boolean,
    endCursor: Schema.optional(Schema.String),
  }),
  errors: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
const Wakeups = Schema.Struct({
  items: Schema.Array(ForgeCronWakeup),
  nextCursor: Schema.optional(Schema.String),
});
const fingerprint = (values: ReadonlyArray<string | number | boolean | null | undefined>) =>
  JSON.stringify(values);
const isMcpFailure = Schema.is(OrchestratorMcpFailure);
const AgentConversation = Schema.Struct({
  state: Schema.String,
  nextCursor: Schema.optional(Schema.String),
  requests: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        kind: Schema.String,
        text: Schema.optional(Schema.String),
        questions: Schema.optional(
          Schema.Array(
            Schema.Struct({
              id: Schema.String,
              question: Schema.String,
              options: Schema.optional(
                Schema.Array(
                  Schema.Struct({
                    label: Schema.String,
                    description: Schema.optional(Schema.String),
                  }),
                ),
              ),
            }),
          ),
        ),
      }),
    ),
  ),
  turns: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.String,
      items: Schema.Array(
        Schema.Struct({
          id: Schema.optional(Schema.String),
          role: Schema.optional(Schema.String),
          text: Schema.String,
        }),
      ),
    }),
  ),
});
const messageSummaries = (turns: typeof AgentConversation.Type.turns, turnId?: string) => {
  let remaining = 12_000;
  return turns
    .filter((t) => !turnId || t.id === turnId)
    .flatMap((t) =>
      t.items
        .filter((i) => i.role === "assistant" || i.role === "user")
        .map((i) => ({
          id: i.id,
          turnId: t.id,
          role: i.role ?? "assistant",
          text: i.text,
          status: t.status,
        })),
    )
    .toReversed()
    .slice(0, 20)
    .flatMap((m) => {
      if (!remaining) return [];
      const length = Math.min(remaining, turnId ? 12_000 : 2000);
      const text = m.text.length > length ? m.text.slice(0, length) + "… [truncated]" : m.text;
      remaining -= Math.min(m.text.length, length);
      return [{ ...m, text }];
    })
    .toReversed();
};
const failure = (message: string) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message });
const scheduleBody = (value: typeof FullSchedule.Type) => ({
  expression: value.expression,
  timezone: value.timezone,
  prompt: value.prompt,
  enabled: value.enabled,
  revision: value.revision,
});
const scheduleSummary = (value: typeof FullSchedule.Type | null) =>
  value
    ? {
        expression: value.expression,
        timezone: value.timezone,
        enabled: value.enabled,
        schedulerEnabled: value.schedulerEnabled,
        nextRunAt: value.nextRunAt,
        revision: value.revision,
      }
    : null;
const brief = (session: typeof ForgeCronSession.Type) => ({
  ...session,
  purpose: session.purpose?.slice(0, 1000),
  progress: session.progress?.slice(0, 2000),
});
export class ForgeCron extends Context.Service<
  ForgeCron,
  {
    readonly read: (
      input: ForgeCronQuery,
    ) => Effect.Effect<ForgeCronResult, OrchestratorMcpFailure>;
    readonly manage: (
      input: ForgeCronMutation,
    ) => Effect.Effect<ForgeCronResult, OrchestratorMcpFailure>;
    readonly observe: Effect.Effect<ReadonlyArray<WorkerObservation>>;
  }
>()("t3/superAgent/ForgeCron") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const server = yield* ServerConfig.ServerConfig;
  const lock = yield* Semaphore.make(1);
  const path = yield* Path.Path;
  const http = (yield* HttpClient.HttpClient).pipe(HttpClient.withScope);
  const home = yield* Config.String("HOME").pipe(Config.withDefault(""));
  const xdg = yield* Config.String("XDG_CONFIG_HOME").pipe(Config.withDefault(""));
  const configFile = path.join(xdg || path.join(home, ".config"), "forge", "config.yaml");
  const legacyFile = path.join(server.stateDir, "super-agent", "forge-legacy-schedules.json");
  const legacyCodec = Schema.Struct({
    origin: Schema.String,
    actor: Schema.String,
    version: Schema.Literal(1),
    records: Schema.Array(ForgeLegacySchedule).check(Schema.isMaxLength(100)),
  });
  const readLegacy = Effect.fn("ForgeCron.readLegacy")(
    function* (owner: { readonly origin: string; readonly actor: string }) {
      if (!(yield* fs.exists(legacyFile))) return [];
      const saved = yield* fs.readFileString(legacyFile).pipe(
        Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(legacyCodec))),
        Effect.mapError(() =>
          failure("Legacy schedule inventory could not be read. It was not overwritten."),
        ),
      );
      if (saved.origin !== owner.origin || saved.actor !== owner.actor)
        return yield* failure(
          "Legacy inventory belongs to another Forge account or server. It was not reused or overwritten.",
        );
      return saved.records;
    },
    Effect.mapError((error) =>
      isMcpFailure(error)
        ? error
        : failure("Legacy inventory could not be read. It was not overwritten."),
    ),
  );
  const settings = Effect.gen(function* () {
    const raw = yield* fs
      .readFileString(configFile)
      .pipe(
        Effect.mapError(() =>
          failure("Forge is not configured here. Sign in with forgectl on this host."),
        ),
      );
    const cfg = yield* Effect.try({
      try: () => YAML.parse(raw) as unknown,
      catch: () => failure("Forge configuration is invalid."),
    }).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Settings)),
      Effect.mapError(() => failure("Forge configuration is invalid.")),
    );
    const origin = yield* Effect.try({
      try: () => new URL(cfg.server),
      catch: () => failure("Forge server URL is invalid."),
    });
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/" ||
      !cfg.api_key
    )
      return yield* failure("Forge requires a configured HTTPS origin and API key.");
    return { origin: origin.origin, key: Redacted.make(cfg.api_key) };
  });
  const request = Effect.fn("ForgeCron.request")(function* <A, I>(
    cfg: { readonly origin: string; readonly key: Redacted.Redacted<string> },
    method: "GET" | "POST" | "PUT" | "PATCH",
    route: string,
    codec: Schema.Codec<A, I>,
    body?: unknown,
  ) {
    const req = HttpClientRequest.make(method)(cfg.origin + "/api/v1" + route).pipe(
      HttpClientRequest.bearerToken(Redacted.value(cfg.key)),
      HttpClientRequest.setHeader("accept", "application/json"),
    );
    return yield* http
      .execute(body === undefined ? req : req.pipe(HttpClientRequest.bodyJsonUnsafe(body)))
      .pipe(
        Effect.flatMap((response) =>
          response.status >= 200 && response.status < 300
            ? response.json.pipe(
                Effect.flatMap(Schema.decodeUnknownEffect(codec)),
                Effect.mapError(() =>
                  failure(
                    "Forge returned an invalid response. Inspect the original session before retrying a change.",
                  ),
                ),
              )
            : Effect.fail(
                failure(
                  `Forge HTTP ${response.status}. ${method === "GET" ? "No change was requested." : "The change may be partial; inspect the original session before retrying."}`,
                ),
              ),
        ),
        Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(1_048_576)),
        Effect.timeout("15 seconds"),
        Effect.scoped,
        Effect.mapError((error) =>
          isMcpFailure(error)
            ? error
            : failure(
                "Forge did not return a receipt. Delivery may be unknown; inspect the original session before retrying.",
              ),
        ),
      );
  });
  const identity = Effect.fn("ForgeCron.identity")(
    (cfg: { readonly origin: string; readonly key: Redacted.Redacted<string> }) =>
      request(cfg, "GET", "/auth/me", Schema.Struct({ email: Schema.String })).pipe(
        Effect.map((actor) => ({ origin: cfg.origin, actor: actor.email })),
      ),
  );
  const page = Effect.fn("ForgeCron.page")((
    cfg: { readonly origin: string; readonly key: Redacted.Redacted<string> },
    cursor: string | undefined,
    limit: number,
    all: boolean,
  ) => {
    const params = new URLSearchParams({
      kind: "cron",
      first: String(limit),
      archived: all ? "all" : "active",
    });
    if (cursor) params.set("after", cursor);
    return request(cfg, "GET", `/agent-sessions?${params}`, SessionPage);
  });
  const read = Effect.fn("ForgeCron.read")(function* (input: ForgeCronQuery) {
    const cfg = yield* settings;
    const actor = yield* identity(cfg);
    if (input.view === "agentReceipt") {
      const view = yield* request(
        cfg,
        "GET",
        "/forge-agent",
        Schema.Struct({ host: Schema.NullOr(Schema.Struct({ id: Schema.Number })) }),
      );
      if (!view.host) return yield* failure("Forge Agent is not enabled. No agent was created.");
      const receipt = yield* request(
        cfg,
        "GET",
        `/forge-agent/messages/${encodeURIComponent(input.requestId)}?hostId=${view.host.id}`,
        Schema.Struct({
          requestId: Schema.String,
          status: Schema.String,
          turnId: Schema.optional(Schema.String),
        }),
      );
      return { ...actor, receipt };
    }
    if (input.view === "agentConversation") {
      const params = new URLSearchParams();
      if (input.cursor) params.set("cursor", input.cursor);
      const value = yield* request(
        cfg,
        "GET",
        `/forge-agent/conversation?${params}`,
        AgentConversation,
      );
      return {
        ...actor,
        agentState: value.state,
        agentRequests: value.requests?.slice(0, 10).map((r) => ({
          id: r.id,
          kind: r.kind,
          text: (r.text ?? "").slice(0, 2000),
          questions:
            r.questions?.slice(0, 5).map((q) => ({
              id: q.id,
              question: q.question.slice(0, 2000),
              options: q.options?.slice(0, 8).map((o) => o.label.slice(0, 240)) ?? [],
            })) ?? [],
        })),
        messages: messageSummaries(value.turns, input.turnId),
        nextCursor: value.nextCursor ?? null,
      };
    }
    if (input.view === "legacy") {
      const records = yield* readLegacy(actor);
      const search = input.search?.trim().toLocaleLowerCase();
      const offset = input.cursor ? Number(input.cursor) : 0;
      if (!Number.isSafeInteger(offset) || offset < 0)
        return yield* failure("Invalid legacy inventory cursor.");
      const rows = records.filter(
        (r) =>
          !search ||
          [r.name, r.sessionId, r.environmentId, r.scriptPath].some((v) =>
            v.toLocaleLowerCase().includes(search),
          ),
      );
      const limit = input.limit ?? 10;
      return {
        ...actor,
        legacy: rows.slice(offset, offset + limit),
        nextCursor: offset + limit < rows.length ? String(offset + limit) : null,
      };
    }
    if (input.view === "preview") {
      const value = yield* request(
        cfg,
        "POST",
        "/agent-sessions/cron-preview",
        Schema.Struct({ next: Schema.Array(Schema.String) }),
        { expression: input.expression, timezone: input.timezone },
      );
      return { ...actor, nextRuns: value.next };
    }
    if (input.view === "environments") {
      const params = new URLSearchParams({ first: String(input.limit ?? 10) });
      if (input.cursor) params.set("after", input.cursor);
      const value = yield* request(
        cfg,
        "GET",
        `/environments?${params}`,
        Schema.Struct({
          environments: Schema.Array(ForgeCronEnvironment),
          pageInfo: SessionPage.fields.pageInfo,
        }),
      );
      const search = input.search?.trim().toLocaleLowerCase();
      return {
        ...actor,
        environments: value.environments.filter(
          (e) => !search || `${e.name} ${e.id}`.toLocaleLowerCase().includes(search),
        ),
        nextCursor: value.pageInfo.hasNextPage ? (value.pageInfo.endCursor ?? null) : null,
      };
    }
    if (input.view === "list") {
      let cursor = input.cursor;
      const search = input.search?.trim().toLocaleLowerCase();
      for (let scan = 0; scan < 5; scan++) {
        const result = yield* page(cfg, cursor, input.limit ?? 10, input.includeArchived ?? false);
        const sessions = result.items
          .filter(
            (s) =>
              !search ||
              [s.name, s.id, s.purpose, s.progress, s.environmentId].some((v) =>
                v?.toLocaleLowerCase().includes(search),
              ),
          )
          .map(brief);
        cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined;
        if (result.pageInfo.hasNextPage && !cursor)
          return yield* failure("Forge pagination is incomplete; no changes were requested.");
        if (sessions.length || !cursor || scan === 4)
          return {
            ...actor,
            sessions,
            nextCursor: cursor ?? null,
            ...(result.errors && Object.keys(result.errors).length
              ? {
                  warning:
                    "Some VMs could not be observed; live=false does not prove their runtimes stopped.",
                }
              : {}),
          };
      }
      return { ...actor, sessions: [], nextCursor: null };
    }
    if (!("sessionId" in input)) return yield* failure("A session ID is required for this view.");
    const route = `/agent-sessions/${encodeURIComponent(input.sessionId)}`;
    if (input.view === "results") {
      const params = new URLSearchParams();
      if (input.cursor) params.set("cursor", input.cursor);
      const value = yield* request(
        cfg,
        "GET",
        `/session-inbox/sessions/${encodeURIComponent(input.sessionId)}?${params}`,
        Schema.Struct({
          items: Schema.Array(ForgeCronOutcome),
          nextCursor: Schema.optional(Schema.String),
        }),
      );
      return {
        ...actor,
        results: value.items.map((r) => ({ ...r, resultText: r.resultText.slice(0, 2000) })),
        nextCursor: value.nextCursor ?? null,
      };
    }
    if (input.view === "wakeups") {
      const params = new URLSearchParams({ first: "10" });
      if (input.cursor) params.set("after", input.cursor);
      const value = yield* request(cfg, "GET", `${route}/wakeups?${params}`, Wakeups);
      return { ...actor, wakeups: value.items, nextCursor: value.nextCursor ?? null };
    }
    const session = yield* request(cfg, "GET", route, ForgeCronSession);
    const schedule = yield* request(cfg, "GET", route + "/schedule", Schema.NullOr(FullSchedule));
    return {
      ...actor,
      session: brief(session),
      schedule: scheduleSummary(schedule),
      ...(schedule ? { prompt: schedule.prompt.slice(0, 12_000) } : {}),
    };
  });
  const manage = Effect.fn("ForgeCron.manage")(function* (input: ForgeCronMutation) {
    const cfg = yield* settings;
    const actor = yield* identity(cfg);
    if (input.operation === "trackLegacy" || input.operation === "untrackLegacy") {
      return yield* lock
        .withPermits(1)(
          Effect.gen(function* () {
            const current = yield* readLegacy(actor);
            const records = current.filter(
              (r) =>
                r.sessionId !==
                (input.operation === "trackLegacy" ? input.record.sessionId : input.sessionId),
            );
            if (input.operation === "trackLegacy") records.push(input.record);
            if (records.length > 100)
              return yield* failure("Legacy inventory is limited to 100 schedules.");
            yield* fs.makeDirectory(path.dirname(legacyFile), { recursive: true });
            yield* fs.writeFileString(
              legacyFile + ".tmp",
              yield* Schema.encodeEffect(Schema.fromJsonString(legacyCodec))({
                ...actor,
                version: 1,
                records,
              }),
              { mode: 0o600 },
            );
            yield* fs.rename(legacyFile + ".tmp", legacyFile);
            return {
              ...actor,
              completedStages: ["legacy_inventory_updated_only_remote_schedule_unchanged"],
            };
          }),
        )
        .pipe(
          Effect.mapError(() =>
            failure("Could not save legacy inventory. No remote schedule was changed."),
          ),
        );
    }
    if (input.operation === "delegateLegacy") {
      const view = yield* request(
        cfg,
        "GET",
        "/forge-agent",
        Schema.Struct({
          host: Schema.NullOr(Schema.Struct({ id: Schema.Number })),
          runtime: Schema.optional(Schema.Struct({ activeTurnId: Schema.optional(Schema.String) })),
        }),
      );
      if (!view.host) return yield* failure("Forge Agent is not enabled. No agent was created.");
      const receipt = yield* request(
        cfg,
        "POST",
        "/forge-agent/messages",
        Schema.Struct({
          requestId: Schema.String,
          status: Schema.String,
          turnId: Schema.optional(Schema.String),
        }),
        {
          hostId: view.host.id,
          requestId: input.requestId,
          mode: view.runtime?.activeTurnId ? "queue" : "start",
          text: input.message,
        },
      );
      return { ...actor, receipt, completedStages: ["forge_agent_delivery_receipt_only"] };
    }
    const stages: string[] = [];
    let session: typeof ForgeCronSession.Type | undefined;
    let schedule: typeof FullSchedule.Type | null = null;
    const work = Effect.gen(function* () {
      if (input.operation === "create") {
        yield* request(
          cfg,
          "POST",
          "/agent-sessions/cron-preview",
          Schema.Struct({ next: Schema.Array(Schema.String) }),
          { expression: input.schedule.expression, timezone: input.schedule.timezone },
        );
        session = yield* request(cfg, "POST", "/agent-sessions", ForgeCronSession, {
          requestId: input.requestId,
          environmentId: input.environmentId,
          agent: input.agent,
          cwd: input.cwd,
          name: input.name,
          purpose: input.name,
          prompt: input.initialPrompt,
        });
        stages.push("session_created_or_recovered");
      }
      const id = input.operation === "create" ? session?.id : input.sessionId;
      if (!id) return yield* failure("Forge did not return the created session ID.");
      const route = `/agent-sessions/${encodeURIComponent(id)}`;
      schedule = yield* request(cfg, "GET", route + "/schedule", Schema.NullOr(FullSchedule));
      if (input.operation === "create" && schedule) {
        if (
          schedule.expression !== input.schedule.expression ||
          schedule.timezone !== input.schedule.timezone ||
          schedule.prompt !== input.schedule.prompt ||
          schedule.enabled !== input.schedule.enabled
        )
          return yield* failure(
            "The recovered session already has a different schedule. Read it before configuring; no overwrite was attempted.",
          );
        stages.push("schedule_already_matches");
        return;
      }
      const expected = input.operation === "create" ? 0 : input.expectedRevision;
      if ((schedule?.revision ?? 0) !== expected)
        return yield* failure("Forge schedule changed. Read its latest revision before editing.");
      if (input.operation !== "configure" && input.operation !== "create" && !schedule)
        return yield* failure("This session has no schedule. No session was stopped or archived.");
      const desired =
        input.operation === "configure" || input.operation === "create"
          ? { ...input.schedule, revision: expected }
          : schedule && { ...scheduleBody(schedule), enabled: input.operation === "resume" };
      if (!desired) return yield* failure("No schedule was supplied.");
      schedule = yield* request(cfg, "PUT", route + "/schedule", FullSchedule, desired);
      if (
        schedule.enabled !== desired.enabled ||
        schedule.expression !== desired.expression ||
        schedule.timezone !== desired.timezone ||
        schedule.prompt !== desired.prompt ||
        schedule.revision <= expected
      )
        return yield* failure(
          "Forge did not confirm the requested schedule. No close or archive was attempted.",
        );
      stages.push(schedule.enabled ? "schedule_enabled" : "schedule_paused");
      if (input.operation === "retire") {
        session = yield* request(cfg, "POST", route + "/close", ForgeCronSession, {});
        if (!session.closedAt || session.live)
          return yield* failure(
            "Forge has not confirmed that this session stopped. It was not archived.",
          );
        stages.push("session_closed");
        session = yield* request(cfg, "PATCH", route, ForgeCronSession, { archived: true });
        if (!session.archivedAt) return yield* failure("Forge has not confirmed archival.");
        stages.push("session_archived_history_retained");
      } else session = yield* request(cfg, "GET", route, ForgeCronSession);
    });
    const result = yield* work.pipe(Effect.result);
    const receiptSchedule = yield* Effect.sync((): typeof FullSchedule.Type | null => schedule);
    const receiptSession = yield* Effect.sync(
      (): typeof ForgeCronSession.Type | undefined => session,
    );
    return {
      ...actor,
      ...(receiptSession ? { session: brief(receiptSession) } : {}),
      schedule: scheduleSummary(receiptSchedule),
      completedStages: stages,
      ...(result._tag === "Failure"
        ? { warning: result.failure.message }
        : receiptSchedule?.enabled && !receiptSchedule.schedulerEnabled
          ? {
              warning:
                "The schedule is saved, but Forge server automation is disabled. Timed delivery is not active.",
            }
          : {}),
    };
  });
  const observe = Effect.gen(function* () {
    if (!(yield* fs.exists(configFile))) return [];
    const cfg = yield* settings;
    const legacy = yield* readLegacy(yield* identity(cfg));
    const legacyWorkers = yield* Effect.forEach(
      legacy,
      (r) =>
        request(
          cfg,
          "GET",
          `/agent-sessions/${encodeURIComponent(r.sessionId)}`,
          ForgeCronSession,
        ).pipe(
          Effect.map((s) => ({
            id: `forge:${s.id}`,
            status: s.attention || s.phase,
            run: fingerprint([s.progress, r.enabled, r.verifiedAt]),
            pending: s.attention || null,
            items: 0,
            updatedAt: Date.parse(s.updatedAt) || 0,
          })),
          Effect.orElseSucceed(() => ({
            id: `forge:${r.sessionId}`,
            status: "unavailable",
            run: null,
            pending: null,
            items: 0,
            updatedAt: 0,
          })),
        ),
      { concurrency: 3 },
    );
    const workers: WorkerObservation[] = [...legacyWorkers];
    if (legacy.length) {
      const agent = yield* request(cfg, "GET", "/forge-agent/conversation", AgentConversation);
      const latest = agent.turns.at(-1);
      workers.push({
        id: "forge:agent",
        status: agent.state,
        run: latest ? fingerprint([latest.id, latest.status]) : null,
        pending: agent.requests?.length
          ? agent.requests
              .map((r) => r.id)
              .sort()
              .join(",")
          : null,
        items: agent.turns.length,
        updatedAt: 0,
      });
    }
    let cursor: string | undefined;
    for (let scan = 0; scan < 5; scan++) {
      const result = yield* page(cfg, cursor, 20, false);
      if (result.errors && Object.keys(result.errors).length)
        return yield* failure("Forge VM observation is incomplete.");
      const batch = yield* Effect.forEach(
        result.items,
        (s) =>
          Effect.gen(function* () {
            const latest = s.schedule
              ? yield* request(
                  cfg,
                  "GET",
                  `/agent-sessions/${encodeURIComponent(s.id)}/wakeups?first=1`,
                  Wakeups,
                )
              : null;
            const wakeup = latest?.items[0];
            return {
              id: `forge:${s.id}`,
              status: s.archivedAt || s.closedAt ? "closed" : s.attention || s.phase,
              run: fingerprint([
                s.progress,
                s.schedule?.revision,
                s.schedule?.enabled,
                wakeup?.requestId,
                wakeup?.state,
                wakeup?.outcome,
                wakeup?.resultEventId,
              ]),
              pending: s.attention || null,
              items: 0,
              updatedAt: Math.max(
                Date.parse(wakeup?.completedAt ?? s.updatedAt) || 0,
                s.schedule?.enabled ? Date.parse(s.schedule.nextRunAt) || 0 : 0,
              ),
            };
          }),
        { concurrency: 3 },
      );
      workers.push(...batch);
      cursor = result.pageInfo.hasNextPage ? result.pageInfo.endCursor : undefined;
      if (!cursor) return [...new Map(workers.map((w) => [w.id, w])).values()];
    }
    return yield* failure(
      "Forge cron inventory exceeds the background scan limit; use paginated reads.",
    );
  }).pipe(
    Effect.orElseSucceed(() => [
      {
        id: "forge:connection",
        status: "unavailable",
        run: null,
        pending: null,
        items: 0,
        updatedAt: 0,
      },
    ]),
  );
  return ForgeCron.of({ read, manage, observe });
});
export const layer = Layer.effect(ForgeCron, make);
