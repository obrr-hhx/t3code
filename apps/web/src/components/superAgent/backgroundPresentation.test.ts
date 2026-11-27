import { expect, it } from "vite-plus/test";
import { MessageId, RunId } from "@t3tools/contracts";
import type { TimelineEntry } from "../../session-logic";
import { deriveMessagesTimelineRows } from "../chat/MessagesTimeline.logic";
const runId = RunId.make("background");
const at = "2026-01-01T00:00:00Z";
const prompt: TimelineEntry = {
  kind: "message",
  id: "background-prompt",
  createdAt: at,
  message: {
    id: MessageId.make("super-agent-observe:1:abc"),
    runId,
    role: "user",
    text: "Internal background inspection",
    createdBy: "system",
    creationSource: "server",
    streaming: false,
    createdAt: at,
    updatedAt: at,
  },
};
const reply = (text: string): TimelineEntry => ({
  kind: "message",
  id: "reply",
  createdAt: at,
  message: {
    id: MessageId.make("reply"),
    runId,
    role: "assistant",
    text,
    streaming: false,
    createdAt: at,
    updatedAt: at,
  },
});
const rows = (entries: TimelineEntry[]) =>
  deriveMessagesTimelineRows({
    timelineEntries: entries,
    isWorking: false,
    turnDiffSummaries: [],
    supportsConversationRollback: false,
  });
it("keeps a no-report background turn silent without hiding meaningful reports", () => {
  expect(rows([prompt, reply("")])).toEqual([]);
  expect(
    rows([prompt, reply("The worker needs a release decision.")])
      .filter((r) => r.kind === "message")
      .map((r) => r.id),
  ).toEqual(["reply"]);
});
it("does not hide an ordinary user prompt or its empty response", () => {
  if (prompt.kind !== "message") throw new Error("Expected message fixture");
  expect(
    rows([{ ...prompt, message: { ...prompt.message, createdBy: "user" } }, reply("")]).filter(
      (r) => r.kind === "message",
    ),
  ).toHaveLength(2);
});

it("filters no-change commentary and requires an accepted evidence-backed report for new background turns", async () => {
  const { visibleManagerReviews } = await import("./backgroundPresentation");
  const runOf = (entry: TimelineEntry) =>
    entry.kind === "message" ? (entry.message.runId ?? null) : null;
  const policy = { since: at, allowed: new Set<RunId>() };
  expect(
    visibleManagerReviews(
      [prompt, reply("（后台巡检：剩余4项目标无新增变化，继续静默等待。）")],
      runOf,
      new Set(),
    ),
  ).toEqual([]);
  expect(
    visibleManagerReviews([prompt, reply("The deployment completed.")], runOf, new Set(), policy),
  ).toEqual([]);
  expect(
    visibleManagerReviews([prompt, reply("The deployment completed.")], runOf, new Set(), {
      ...policy,
      allowed: new Set([runId]),
    }),
  ).toHaveLength(1);
  expect(
    visibleManagerReviews(
      [prompt, reply("Execution failed: service unreachable")],
      runOf,
      new Set([runId]),
      policy,
    ),
  ).toHaveLength(1);
  if (prompt.kind !== "message") throw new Error("Fixture");
  const human = { ...prompt, message: { ...prompt.message, createdBy: "user" as const } };
  expect(
    visibleManagerReviews([human, reply("无新增变化")], runOf, new Set(), policy),
  ).toHaveLength(2);
});

it("retains meaningful history before policy rollout and a stable view across unrelated renders", async () => {
  const { visibleManagerReviews } = await import("./backgroundPresentation");
  const runOf = (entry: TimelineEntry) =>
    entry.kind === "message" ? (entry.message.runId ?? null) : null;
  const history = [prompt, reply("The release completed and is healthy.")];
  const policy = { since: "2026-02-01T00:00:00Z", allowed: new Set<RunId>() };
  const first = visibleManagerReviews(history, runOf, new Set(), policy);
  expect(first).toHaveLength(1);
  expect(visibleManagerReviews(history, runOf, new Set(), policy)).toBe(first);
});
