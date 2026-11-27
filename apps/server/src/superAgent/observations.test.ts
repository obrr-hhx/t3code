import * as DateTime from "effect/DateTime";
import { expect, it } from "vite-plus/test";
import { emptyObservation, observe, type WorkerObservation } from "./observations.ts";
import type { SuperAgentRecord } from "@t3tools/contracts";
import { RunId, ThreadId } from "@t3tools/contracts";
const worker: WorkerObservation = {
  id: "worker",
  status: "running",
  run: "run-one",
  pending: null,
  items: 1,
  updatedAt: 0,
};
it("stays silent through twenty hourly unchanged checks and dispatches a changed result once", () => {
  let state = observe(emptyObservation(), [worker], [], 0);
  for (let i = 1; i <= 20; i++) {
    state = observe(state, [{ ...worker, updatedAt: i * 3600000 }], [], i * 3600000);
    expect(state.pending).toBeNull();
  }
  state = observe(state, [{ ...worker, status: "completed" }], [], 21 * 3600000);
  expect(state.pending?.id).toContain("super-agent-observe:");
  const pending = state;
  expect(observe(state, [{ ...worker, status: "completed" }], [], 22 * 3600000)).toBe(pending);
  state = { ...state, pending: null };
  expect(observe(state, [{ ...worker, status: "completed" }], [], 23 * 3600000)).toBe(state);
});
it("checks stalled goals again on schedule without repeating the same progress inquiry and respects explicit pause", () => {
  const goal: SuperAgentRecord = {
    id: "goal",
    kind: "goal",
    title: "Finish the tests",
    content: "Existing authorized task",
    status: "active",
    goalId: null,
    dedupeKey: "tests",
    workerThreadId: ThreadId.make("worker"),
    options: [],
    answer: null,
    updatedAt: "2026-01-01T00:00:00Z",
  };
  let state = observe({ ...emptyObservation(), nextCheckAt: 1 }, [worker], [goal], 0);
  state = observe(state, [worker], [goal], 30 * 60000);
  expect(state.pending?.text).toContain("no progress");
  state = { ...state, pending: null };
  expect(observe(state, [worker], [goal], 60 * 60000).pending?.text).not.toContain("no progress");
  const paused = { ...state, paused: true, nextCheckAt: null, lastStall: null };
  expect(observe(paused, [worker], [goal], 120 * 60000).pending).toBeNull();
  expect(
    observe(paused, [{ ...worker, pending: "question-one" }], [goal], 121 * 60000).pending,
  ).toBeNull();
});

it("gives a later repeat transition a new command identity while retaining a pending delivery identity", () => {
  const idle = [
    {
      id: "remote/connection",
      status: "reachable",
      run: null,
      pending: null,
      items: 0,
      updatedAt: 0,
    },
  ];
  const offline = [{ ...idle[0]!, status: "unreachable" }];
  const initial = observe(emptyObservation(), idle, [], 0);
  const first = observe(initial, offline, [], 1);
  expect(observe(first, offline, [], 2)).toBe(first);
  const recovered = observe({ ...first, pending: null }, idle, [], 3);
  const second = observe({ ...recovered, pending: null }, offline, [], 4);
  expect(second.pending?.id).not.toBe(first.pending?.id);
});

it("tracks a Forge-linked goal without pretending its session is a T3 thread", () => {
  const goal: SuperAgentRecord = {
    id: "goal",
    kind: "goal",
    title: "Daily check",
    content: "Check cron results",
    status: "active",
    goalId: null,
    dedupeKey: "cron-check",
    workerThreadId: null,
    forgeSessionId: "cron-one",
    options: [],
    answer: null,
    updatedAt: "2026-01-01T00:00:00Z",
  };
  const cron = { ...worker, id: "forge:cron-one" };
  let state = observe({ ...emptyObservation(), nextCheckAt: 1 }, [cron], [goal], 0);
  state = observe(state, [cron], [goal], 30 * 60_000);
  expect(state.pending?.text).toContain("no progress");
  state = { ...state, pending: null };
  for (let i = 1; i <= 24; i++) {
    const next = observe(state, [cron], [goal], i * 3600_000);
    expect(next.pending?.text ?? "").not.toContain("no progress");
    state = { ...next, pending: null };
  }
});

const externalGoal = (
  id: string,
  status: SuperAgentRecord["status"] = "blocked",
): SuperAgentRecord => ({
  id,
  kind: "goal",
  title: `Verify external rollout ${id}`,
  content: "An external owner applies the change. Inspect its rollout evidence.",
  status,
  goalId: null,
  dedupeKey: id,
  workerThreadId: null,
  options: [],
  answer: null,
  updatedAt: "2026-01-01T00:00:00Z",
});
it("wakes at the chosen deadline for external blocked and pending goals without any worker transition", () => {
  const goals = [externalGoal("external"), externalGoal("pending", "pending")];
  const initial = observe({ ...emptyObservation(), nextCheckAt: 60000 }, [], goals, 0);
  const next = observe(initial, [], goals, 60000);
  expect(next.pending?.text).toContain('"id":"external"');
  expect(next.pending?.text).toContain('"id":"pending"');
  expect(next.nextCheckAt).toBeGreaterThan(60000);
  expect(observe({ ...next, pending: null }, [], goals, 60001).pending).toBeNull();
});
it("offers every unfinished goal in bounded batches, including missing workers, and resumes after a restart", () => {
  const goals = Array.from({ length: 25 }, (_, i) =>
    externalGoal(`goal-${String(i).padStart(2, "0")}`),
  );
  goals.push(externalGoal("completed", "done"), externalGoal("archived", "archived"));
  let state = observe({ ...emptyObservation(), nextCheckAt: 1 }, [], goals, 0);
  const seen = new Set<string>();
  for (let i = 0; i < 3; i++) {
    state = observe(state, [], goals, 1 + i);
    const text = state.pending!.text;
    const batch = JSON.parse(
      text.split("Goal batch JSON:\n")[1]!.split("\nEnd goal batch.")[0]!,
    ) as { id: string }[];
    expect(batch.length).toBeLessThanOrEqual(10);
    batch.forEach((g) => {
      seen.add(g.id);
      const goal = goals.find((x) => x.id === g.id)!;
      const verified = {
        checkedAt: DateTime.formatIso(DateTime.makeUnsafe(1 + i)),
        outcome: "unchanged",
        summary: "Checked",
        evidenceQuote: "Actual completed read-only evidence",
        evidenceItemId: "read-1",
        runId: RunId.make("inspection"),
        fingerprint: "sample",
        nextCheckAt: DateTime.formatIso(DateTime.makeUnsafe(1800000)),
      } as const;
      goals[goals.indexOf(goal)] = { ...goal, verification: verified };
    });
    state = JSON.parse(JSON.stringify({ ...state, pending: null }));
  }
  expect([...seen].sort()).toEqual(goals.slice(0, 25).map((g) => g.id));
  expect(observe(state, [], goals, 4).pending).toBeNull();
});
it("does not silently abandon unfinished goals when no deadline was saved, but honors an explicit user pause", () => {
  const goals = [externalGoal("external")];
  expect(observe(emptyObservation(), [], goals, 0).pending).not.toBeNull();
  const paused = { ...emptyObservation(), paused: true };
  expect(observe(paused, [worker], goals, 60000).pending).toBeNull();
});

it("keeps a dispatched goal unverified, retries with backoff and does not advance the batch on delivery alone", () => {
  const goals = Array.from({ length: 11 }, (_, i) => externalGoal(`pending-${i}`));
  const sent = observe({ ...emptyObservation(), nextCheckAt: 0 }, [], goals, 1);
  expect(sent.inFlight?.goalIds).toHaveLength(10);
  expect(sent.reviewQueue).toHaveLength(1);
  const accepted = { ...sent, pending: null };
  expect(observe(accepted, [], goals, 60000)).toBe(accepted);
  const retry = observe(accepted, [], goals, 300001);
  expect(retry.inFlight?.attempt).toBe(2);
  expect(retry.inFlight?.goalIds).toEqual(sent.inFlight?.goalIds);
  expect(retry.reviewQueue).toEqual(sent.reviewQueue);
  expect(goals.every((g) => g.verification === undefined)).toBe(true);
});
