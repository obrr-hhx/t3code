import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerConfig from "../config.ts";
import * as Forge from "./ForgeCron.ts";

const session = {
  id: "cron-one",
  name: "Daily review",
  environmentId: "vm-one",
  phase: "ready",
  live: true,
  agent: "codex",
  updatedAt: "2026-01-01T00:00:00Z",
};
const schedule = {
  expression: "0 9 * * *",
  timezone: "Asia/Shanghai",
  prompt: "Review test results",
  enabled: true,
  schedulerEnabled: true,
  nextRunAt: "2026-01-02T01:00:00Z",
  revision: 2,
};
const setup = Effect.fn("ForgeCronTest.setup")(function* (
  route: (url: URL, method: string, body: unknown) => { status?: number; body: unknown },
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "forge-cron-test-" });
  yield* fs.makeDirectory(path.join(root, "forge"));
  yield* fs.writeFileString(
    path.join(root, "forge", "config.yaml"),
    "server: https://forge.example\napi_key: test-only-key\n",
  );
  const calls: string[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      calls.push(`${request.method} ${new URL(request.url).pathname}`);
      const body =
        request.body._tag === "Uint8Array"
          ? (JSON.parse(new TextDecoder().decode(request.body.body)) as unknown)
          : undefined;
      const result = new URL(request.url).pathname.endsWith("/auth/me")
        ? { body: { email: "user@example.com" } }
        : route(new URL(request.url), request.method, body);
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(result.body), {
          status: result.status ?? 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }),
  );
  const config = yield* ServerConfig.layerTest(root, { prefix: "forge-cron" }).pipe(Layer.build);
  const service = yield* Forge.ForgeCron.pipe(
    Effect.provide(
      Forge.layer.pipe(
        Layer.provide(Layer.succeedContext(config)),
        Layer.provide(Layer.succeed(HttpClient.HttpClient, client)),
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromEnv({ env: { XDG_CONFIG_HOME: root, HOME: root } }),
          ),
        ),
      ),
    ),
  );
  return { service, calls };
});
it.layer(NodeServices.layer)("Forge cron adapter", (it) => {
  it.effect(
    "search preserves server cursors, bounds results and omits terminal and credential fields",
    () =>
      Effect.gen(function* () {
        const { service } = yield* setup((url) => {
          expect(url.searchParams.get("kind")).toBe("cron");
          const second = url.searchParams.get("after") === "page-2";
          return {
            body: {
              items: [
                {
                  ...session,
                  name: second ? "Deploy review" : "Other",
                  terminal: { secret: "not-returned" },
                },
              ],
              pageInfo: { hasNextPage: !second, endCursor: "page-2" },
            },
          };
        });
        const result = yield* service.read({ view: "list", search: "Deploy", limit: 1 });
        expect(result.sessions).toHaveLength(1);
        expect(result.nextCursor).toBeNull();
        expect(JSON.stringify(result)).not.toContain("not-returned");
        expect(JSON.stringify(result)).not.toContain("test-only-key");
      }),
  );
  it.effect("refuses stale schedule edits without a write", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup(() => ({ body: schedule }));
      const result = yield* service.manage({
        operation: "pause",
        sessionId: session.id,
        expectedRevision: 1,
      });
      expect(result.warning).toContain("changed");
      expect(calls.every((c) => c.startsWith("GET"))).toBe(true);
    }),
  );
  it.effect("pause sends only editable fields and does not stop the current turn", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup((url, method, body) => {
        if (method === "PUT") {
          expect(body).toEqual({
            expression: schedule.expression,
            timezone: schedule.timezone,
            prompt: schedule.prompt,
            enabled: false,
            revision: 2,
          });
          return { body: { ...schedule, enabled: false, revision: 3 } };
        }
        return { body: url.pathname.endsWith("/schedule") ? schedule : session };
      });
      const result = yield* service.manage({
        operation: "pause",
        sessionId: session.id,
        expectedRevision: 2,
      });
      expect(result.warning).toBeUndefined();
      expect(result.completedStages).toEqual(["schedule_paused"]);
      expect(calls.some((c) => c.endsWith("/close"))).toBe(false);
    }),
  );
  it.effect(
    "retire stops at an uncertain close, retains the pause receipt and never archives or deletes a VM",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* setup((url, method) => {
          if (url.pathname.endsWith("/close"))
            return { status: 504, body: { error: "private backend diagnostics" } };
          return {
            body: method === "PUT" ? { ...schedule, enabled: false, revision: 3 } : schedule,
          };
        });
        const result = yield* service.manage({
          operation: "retire",
          sessionId: session.id,
          expectedRevision: 2,
        });
        expect(result.completedStages).toEqual(["schedule_paused"]);
        expect(result.warning).toContain("HTTP 504");
        expect(result.warning).not.toContain("private backend");
        expect(calls.some((c) => c.startsWith("PATCH") || c.includes("/environments"))).toBe(false);
      }),
  );
  it.effect("retire verifies session closure before archival and retains history", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup((url, method) => ({
        body:
          method === "PATCH"
            ? {
                ...session,
                live: false,
                closedAt: "2026-01-01T00:00:00Z",
                archivedAt: "2026-01-01T00:00:00Z",
              }
            : url.pathname.endsWith("/close")
              ? { ...session, live: false, closedAt: "2026-01-01T00:00:00Z" }
              : method === "PUT"
                ? { ...schedule, enabled: false, revision: 3 }
                : schedule,
      }));
      const result = yield* service.manage({
        operation: "retire",
        sessionId: session.id,
        expectedRevision: 2,
      });
      expect(result.completedStages).toEqual([
        "schedule_paused",
        "session_closed",
        "session_archived_history_retained",
      ]);
      expect(calls.slice(-3)).toEqual([
        "PUT /api/v1/agent-sessions/cron-one/schedule",
        "POST /api/v1/agent-sessions/cron-one/close",
        "PATCH /api/v1/agent-sessions/cron-one",
      ]);
    }),
  );
  it.effect(
    "create reuses its request identity and reports a created session even if schedule save fails",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* setup((url, method, body) => {
          if (url.pathname.endsWith("cron-preview"))
            return { body: { next: [schedule.nextRunAt] } };
          if (url.pathname.endsWith("/agent-sessions") && method === "POST") {
            expect(body).toMatchObject({ requestId: "stable-request", prompt: "Inspect tests" });
            return { body: session };
          }
          return method === "PUT" ? { status: 503, body: {} } : { body: null };
        });
        const result = yield* service.manage({
          operation: "create",
          requestId: "stable-request",
          environmentId: "vm-one",
          agent: "codex",
          cwd: "/home/user/app",
          name: "Daily review",
          initialPrompt: "Inspect tests",
          schedule,
        });
        expect(result.session?.id).toBe(session.id);
        expect(result.completedStages).toEqual(["session_created_or_recovered"]);
        expect(result.warning).toContain("HTTP 503");
        expect(calls.filter((c) => c === "POST /api/v1/agent-sessions")).toHaveLength(1);
      }),
  );
  it.effect("does not follow redirects or expose response diagnostics", () =>
    Effect.gen(function* () {
      const { service, calls } = yield* setup(() => ({
        status: 302,
        body: { token: "do-not-return" },
      }));
      const result = yield* service.read({ view: "list" }).pipe(Effect.flip);
      expect(result.message).toContain("HTTP 302");
      expect(result.message).not.toContain("do-not-return");
      expect(calls).toHaveLength(2);
    }),
  );
  it.effect("does not call an enabled plan active when server automation is disabled", () =>
    Effect.gen(function* () {
      const { service } = yield* setup((url, method) => ({
        body: url.pathname.endsWith("/schedule")
          ? { ...schedule, schedulerEnabled: false, revision: method === "PUT" ? 3 : 2 }
          : session,
      }));
      const result = yield* service.manage({
        operation: "resume",
        sessionId: session.id,
        expectedRevision: 2,
      });
      expect(result.warning).toContain("server automation is disabled");
    }),
  );
  it.effect(
    "observes outcome transitions without treating future scheduled waiting as a stall",
    () =>
      Effect.gen(function* () {
        let outcome = "completed";
        const { service } = yield* setup((url) => ({
          body: url.pathname.endsWith("/wakeups")
            ? {
                items: [
                  {
                    requestId: "wake-one",
                    scheduledAt: "2026-01-01T01:00:00Z",
                    state: "delivered",
                    outcome,
                  },
                ],
              }
            : { items: [{ ...session, schedule }], pageInfo: { hasNextPage: false } },
        }));
        const first = yield* service.observe;
        expect(first[0]?.updatedAt).toBe(Date.parse(schedule.nextRunAt));
        expect(yield* service.observe).toEqual(first);
        outcome = "failed";
        expect((yield* service.observe)[0]?.run).not.toBe(first[0]?.run);
      }),
  );
  it.effect(
    "tracks and untracks legacy plans without rewriting their scheduler or launching a worker",
    () =>
      Effect.gen(function* () {
        const { service, calls } = yield* setup(() => ({ body: {} }));
        const record = {
          sessionId: session.id,
          name: session.name,
          environmentId: session.environmentId,
          expression: schedule.expression,
          timezone: schedule.timezone,
          scriptPath: "/home/user/watch.sh",
          enabled: true,
          verifiedAt: "2026-01-01T00:00:00Z",
          evidenceRequestId: "11111111-1111-4111-8111-111111111111",
        };
        yield* service.manage({ operation: "trackLegacy", record });
        expect((yield* service.read({ view: "legacy", search: "Daily" })).legacy).toEqual([record]);
        yield* service.manage({ operation: "untrackLegacy", sessionId: session.id });
        expect((yield* service.read({ view: "legacy" })).legacy).toEqual([]);
        expect(calls.every((c) => c === "GET /api/v1/auth/me")).toBe(true);
      }),
  );
  it.effect(
    "delegates VM schedule work to an existing busy Forge Agent as a queued instruction",
    () =>
      Effect.gen(function* () {
        const requestId = "11111111-1111-4111-8111-111111111111";
        const { service, calls } = yield* setup((url, method, body) => {
          if (method === "POST") {
            expect(body).toEqual({
              hostId: 7,
              requestId,
              mode: "queue",
              text: "Inspect the existing VM schedule",
            });
            return { body: { requestId, status: "queued" } };
          }
          return { body: { host: { id: 7 }, runtime: { activeTurnId: "other-work" } } };
        });
        const result = yield* service.manage({
          operation: "delegateLegacy",
          requestId,
          message: "Inspect the existing VM schedule",
        });
        expect(result.receipt?.status).toBe("queued");
        expect(result.completedStages).toEqual(["forge_agent_delivery_receipt_only"]);
        expect(calls).not.toContain("POST /api/v1/forge-agent");
      }),
  );
});
