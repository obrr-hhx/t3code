import { emptyObservation, type ObservationState } from "./observations.ts";
import type {
  ProjectId,
  SuperAgentMutation,
  SuperAgentQuery,
  SuperAgentRecord,
  SuperAgentSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { SuperAgentError } from "@t3tools/contracts";

export interface State {
  readonly observation: ObservationState;
  readonly notices: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  readonly version: 1;
  readonly threadId: ThreadId | null;
  readonly projectId: ProjectId | null;
  readonly revision: number;
  readonly summary: string;
  readonly records: ReadonlyArray<SuperAgentRecord>;
  readonly receipts: ReadonlyArray<{ readonly id: string; readonly payload: string }>;
}
export const emptyState = (): State => ({
  observation: emptyObservation(),
  notices: [],
  version: 1,
  threadId: null,
  projectId: null,
  revision: 0,
  summary: "",
  records: [],
  receipts: [],
});

export function queryState(state: State, query: SuperAgentQuery): SuperAgentSnapshot {
  const search = query.search?.trim().toLocaleLowerCase();
  const rows = state.records
    .filter(
      (r) =>
        (!query.id || r.id === query.id) &&
        (!query.kind || r.kind === query.kind) &&
        (query.id ||
          query.includeCompleted ||
          !["done", "archived", "answered"].includes(r.status)) &&
        (!search || `${r.title}\n${r.content}`.toLocaleLowerCase().includes(search)),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  const offset = query.cursor ?? 0,
    limit = Math.min(20, query.limit ?? 10);
  return {
    nextCheckAt: state.observation.nextCheckAt,
    pendingDeliveries: state.notices.length,
    storageAvailable: true,
    threadId: state.threadId,
    projectId: state.projectId,
    revision: state.revision,
    summary: query.kind === "memory" ? state.summary : "",
    total: rows.length,
    records: rows
      .slice(offset, offset + limit)
      .map((r) => ({ ...r, content: r.content.slice(0, query.id ? 12_000 : 300) })),
    nextCursor: offset + limit < rows.length ? offset + limit : null,
  };
}

export function changeState(
  state: State,
  input: SuperAgentMutation,
  actor: "user" | "agent",
  now: string,
): State {
  const payload = JSON.stringify({ revision: input.expectedRevision, operation: input.operation });
  const receipt = state.receipts.find((r) => r.id === input.requestId);
  if (receipt) {
    if (receipt.payload !== payload) throw new SuperAgentError({ reason: "conflict" });
    return state;
  }
  if (state.revision !== input.expectedRevision) throw new SuperAgentError({ reason: "conflict" });
  let observation = state.observation;
  let records = [...state.records],
    summary = state.summary;
  const op = input.operation;
  if (op.type === "plan")
    observation = {
      ...observation,
      nextCheckAt: op.afterMinutes === null ? null : Date.parse(now) + op.afterMinutes * 60000,
    };
  else if (op.type === "summary") summary = op.text;
  else if (op.type === "delete") {
    if (actor !== "user") throw new SuperAgentError({ reason: "invalid" });
    records = records.filter((r) => r.id !== op.id);
  } else if (op.type === "answer") {
    if (actor !== "user" || !op.answer.trim()) throw new SuperAgentError({ reason: "invalid" });
    const old = records.find((r) => r.id === op.id && r.kind === "decision");
    if (!old) throw new SuperAgentError({ reason: "conflict" });
    records = records.map((r) =>
      r.id === op.id ? { ...r, answer: op.answer, status: "answered", updatedAt: now } : r,
    );
  } else {
    const incoming = op.record;
    const old = records.find(
      (r) =>
        r.id === incoming.id ||
        (r.kind === incoming.kind &&
          r.goalId === incoming.goalId &&
          r.dedupeKey === incoming.dedupeKey),
    );
    if (old && old.kind !== incoming.kind) throw new SuperAgentError({ reason: "invalid" });
    if (actor === "agent" && incoming.answer !== null && old?.answer !== incoming.answer)
      throw new SuperAgentError({ reason: "invalid" });
    const updated = {
      ...incoming,
      id: old?.id ?? incoming.id,
      answer: old?.answer ?? incoming.answer,
      updatedAt: now,
    };
    // A worker update cannot reopen an answered decision or erase the human's answer.
    if (old?.answer !== null && old?.answer !== undefined && updated.status === "pending")
      updated.status = old.status;
    records = [...records.filter((r) => r.id !== updated.id), updated];
  }
  return {
    ...state,
    observation,
    notices:
      actor === "user" &&
      (op.type === "answer" || (op.type === "upsert" && op.record.kind === "goal"))
        ? [
            ...state.notices,
            {
              id: `super-agent-notice:${input.requestId}`,
              text:
                op.type === "answer"
                  ? `用户对「${records.find((r) => r.id === op.id)?.title ?? op.id}」的决定：\n${op.answer}`
                  : `目标：${op.record.title}\n${op.record.content}`,
            },
          ]
        : state.notices,
    records,
    summary,
    revision: state.revision + 1,
    receipts: [...state.receipts, { id: input.requestId, payload }].slice(-256),
  };
}
