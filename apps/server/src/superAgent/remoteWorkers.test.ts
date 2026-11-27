import { expect, it } from "@effect/vitest";
import { EnvironmentId, OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { PeerMcpClient } from "../peer/PeerMcpClient.ts";
import { readRemoteWorkers } from "./remoteWorkers.ts";

it.effect("pages existing authorized links without creating connections", () =>
  Effect.gen(function* () {
    const cursors: unknown[] = [];
    const peers: PeerMcpClient["Service"] = {
      call: (input) => {
        cursors.push(input.arguments.cursor);
        expect(input.tool).toBe("t3_thread_list");
        expect(input.limits.runtimeMode).toBe("approval-required");
        const result = {
          projectId: null,
          currentThreadId: null,
          threads: [],
          nextCursor: cursors.length === 1 ? 100 : null,
          total: 0,
        };
        // oxlint-disable-next-line t3code/no-inline-schema-compile -- Each generic mock call supplies its own result schema.
        return Schema.decodeEffect(input.success)(result).pipe(
          Effect.mapError(
            () =>
              new OrchestratorMcpFailure({ code: "invalid_request", message: "Invalid test page" }),
          ),
        );
      },
    };
    const workers = yield* readRemoteWorkers(
      {
        enabled: Effect.succeed(true),
        names: Effect.succeed([{ environmentId: EnvironmentId.make("remote"), label: "Remote" }]),
      },
      peers,
    );
    expect(cursors).toEqual([0, 100]);
    expect(workers).toEqual([]);
  }),
);
it.effect("reports a disconnected peer once as connection state and respects disabled links", () =>
  Effect.gen(function* () {
    const peers: PeerMcpClient["Service"] = {
      call: () =>
        Effect.fail(
          new OrchestratorMcpFailure({ code: "orchestration_error", message: "Offline" }),
        ),
    };
    const names = Effect.succeed([
      { environmentId: EnvironmentId.make("remote"), label: "Remote" },
    ]);
    expect(yield* readRemoteWorkers({ enabled: Effect.succeed(false), names }, peers)).toEqual([]);
    expect(yield* readRemoteWorkers({ enabled: Effect.succeed(true), names }, peers)).toMatchObject(
      [{ id: "remote/connection", status: "unreachable" }],
    );
  }),
);
