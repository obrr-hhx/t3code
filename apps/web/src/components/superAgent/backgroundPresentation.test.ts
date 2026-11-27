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
