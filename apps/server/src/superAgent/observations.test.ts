import { expect, it } from "vite-plus/test";
import { emptyObservation, observe, type WorkerObservation } from "./observations.ts";
import type { SuperAgentRecord } from "@t3tools/contracts";
import { ThreadId } from "@t3tools/contracts";
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
it("asks about a stalled goal once, respects an indefinite pause and wakes for a new question", () => {
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
  expect(observe(state, [worker], [goal], 60 * 60000).pending).toBeNull();
  const paused = { ...state, nextCheckAt: null, lastStall: null };
  expect(observe(paused, [worker], [goal], 120 * 60000).pending).toBeNull();
  expect(
    observe(paused, [{ ...worker, pending: "question-one" }], [goal], 121 * 60000).pending,
  ).not.toBeNull();
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
