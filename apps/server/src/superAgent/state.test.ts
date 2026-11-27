import { describe, expect, it } from "vite-plus/test";
import type { SuperAgentMutation, SuperAgentRecord } from "@t3tools/contracts";
import { changeState, emptyState, queryState } from "./state.ts";

const now = "2026-01-01T00:00:00Z";
const record = (id: string, patch: Partial<SuperAgentRecord> = {}): SuperAgentRecord => ({
  id,
  kind: "decision",
  title: "Choose rollout timing",
  content: "The worker needs a release window.",
  status: "pending",
  goalId: "release",
  dedupeKey: "release-window",
  workerThreadId: null,
  options: ["Now", "Tomorrow"],
  answer: null,
  updatedAt: now,
  ...patch,
});
const upsert = (r: SuperAgentRecord, revision: number, requestId = r.id): SuperAgentMutation => ({
  requestId,
  expectedRevision: revision,
  operation: { type: "upsert", record: r },
});

describe("manager records", () => {
  it("deduplicates an evolving question and never reopens or fabricates its human answer", () => {
    let state = changeState(emptyState(), upsert(record("one"), 0), "agent", now);
    state = changeState(
      state,
      upsert(record("duplicate", { title: "Release window still needed" }), 1),
      "agent",
      now,
    );
    expect(state.records).toHaveLength(1);
    expect(state.records[0]?.id).toBe("one");
    state = changeState(
      state,
      {
        requestId: "answer",
        expectedRevision: 2,
        operation: { type: "answer", id: "one", answer: "Tomorrow" },
      },
      "user",
      now,
    );
    state = changeState(
      state,
      upsert(record("one", { content: "Updated evidence" }), 3, "worker-update"),
      "agent",
      now,
    );
    expect(state.records[0]).toMatchObject({ status: "answered", answer: "Tomorrow" });
    expect(() =>
      changeState(state, upsert(record("one", { answer: "Now" }), 4, "fake-answer"), "agent", now),
    ).toThrow();
    state = changeState(
      state,
      {
        requestId: "human-correction",
        expectedRevision: 4,
        operation: { type: "answer", id: "one", answer: "Now" },
      },
      "user",
      now,
    );
    expect(state.records[0]?.answer).toBe("Now");
  });
  it("replays an identical mutation once and refuses conflicting request reuse or stale writes", () => {
    const input = upsert(record("one"), 0);
    const state = changeState(emptyState(), input, "user", now);
    expect(changeState(state, input, "user", now)).toBe(state);
    expect(() =>
      changeState(state, { ...input, operation: { type: "delete", id: "one" } }, "user", now),
    ).toThrow();
    expect(() => changeState(state, upsert(record("two"), 0), "user", now)).toThrow();
    expect(() =>
      changeState(
        state,
        {
          requestId: "worker-delete",
          expectedRevision: 1,
          operation: { type: "delete", id: "one" },
        },
        "agent",
        now,
      ),
    ).toThrow();
  });
  it("pages and searches records without dumping full content or losing text when opening one", () => {
    let state = emptyState();
    for (let i = 0; i < 25; i++)
      state = changeState(
        state,
        upsert(
          record(`row-${i}`, {
            dedupeKey: `key-${i}`,
            title: `Question ${i}`,
            content: "a".repeat(5000),
          }),
          state.revision,
        ),
        "user",
        now,
      );
    const page = queryState(state, { limit: 10 });
    expect(page.records).toHaveLength(10);
    expect(page.nextCursor).toBe(10);
    expect(page.records.every((r) => r.content.length <= 300)).toBe(true);
    expect(queryState(state, { cursor: 20, limit: 10 }).records).toHaveLength(5);
    expect(queryState(state, { search: "Question 24" }).records.map((r) => r.id)).toEqual([
      "row-24",
    ]);
    expect(queryState(state, { id: "row-24" }).records[0]?.content).toHaveLength(5000);
    state = changeState(
      state,
      {
        requestId: "summary",
        expectedRevision: state.revision,
        operation: { type: "summary", text: "Prefer existing workers." },
      },
      "user",
      now,
    );
    expect(queryState(state, {}).summary).toBe("");
    expect(queryState(state, { kind: "memory" }).summary).toBe("Prefer existing workers.");
  });
});
