import * as DateTime from "effect/DateTime";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- stable evidence and delivery identity.
import * as NodeCrypto from "node:crypto";
import {
  DEFAULT_GOAL_CHECK_MS,
  isUnfinishedGoal,
  emptyObservation,
  type ObservationState,
} from "./observations.ts";
import type {
  RunId,
  ProjectId,
  SuperAgentMutation,
  SuperAgentQuery,
  SuperAgentRecord,
  SuperAgentSnapshot,
  ThreadId,
} from "@t3tools/contracts";
import { SuperAgentError } from "@t3tools/contracts";

export interface State {
  readonly reportPolicyAt: string | null;
  readonly reportRunIds: ReadonlyArray<RunId>;
  readonly continuations: ReadonlyArray<{
    readonly id: string;
    readonly goalId: string;
    readonly threadId: ThreadId;
    readonly environmentId?: import("@t3tools/contracts").EnvironmentId | undefined;
    readonly text: string;
  }>;
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
  reportPolicyAt: null,
  reportRunIds: [],
  continuations: [],
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
    ...(state.reportPolicyAt ? { reportPolicyAt: state.reportPolicyAt } : {}),
    reportRunIds: state.reportRunIds.filter((id) =>
      query.reportRunIds
        ? query.reportRunIds.includes(id)
        : state.reportRunIds.slice(-256).includes(id),
    ),
    pendingVerificationIds: state.observation.inFlight?.goalIds ?? [],
    nextCheckAt: state.observation.nextCheckAt,
    pendingDeliveries: state.notices.length + state.continuations.length,
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
  let reportRunIds = state.reportRunIds,
    continuations = state.continuations;
  if (op.type === "plan") {
    const paused = actor === "user" ? op.afterMinutes === null : observation.paused;
    observation = {
      ...observation,
      paused,
      ...(paused ? { pending: null, reviewQueue: [], inFlight: null } : {}),
      nextCheckAt: paused
        ? null
        : op.afterMinutes !== null
          ? Date.parse(now) + op.afterMinutes * 60000
          : records.some(isUnfinishedGoal)
            ? Date.parse(now) + DEFAULT_GOAL_CHECK_MS
            : null,
    };
  } else if (op.type === "verify") {
    const goal = records.find((r) => r.id === op.goalId && r.kind === "goal");
    if (!goal || !op.runId || !op.evidenceItemId) throw new SuperAgentError({ reason: "invalid" });
    const fingerprint = NodeCrypto.createHash("sha256")
      .update(
        JSON.stringify([
          goal.id,
          op.outcome,
          op.evidenceQuote.replace(/\s+/g, " ").trim(),
          goal.blocker?.condition,
        ]),
      )
      .digest("hex");
    const changed = fingerprint !== goal.verification?.fingerprint;
    const verification = {
      checkedAt: now,
      outcome: op.outcome,
      summary: op.summary,
      evidenceQuote: op.evidenceQuote,
      evidenceItemId: op.evidenceItemId,
      runId: op.runId,
      fingerprint,
      nextCheckAt: DateTime.formatIso(
        DateTime.makeUnsafe(Date.parse(now) + op.afterMinutes * 60000),
      ),
    };
    if (
      op.outcome === "ready" &&
      (!goal.blocker ||
        goal.blocker.kind !== "external" ||
        !goal.workerThreadId ||
        !goal.blocker.continuation.trim())
    )
      throw new SuperAgentError({ reason: "invalid" });
    if (op.report && op.outcome !== "unchanged" && changed) {
      if (
        op.report === "decision" &&
        !records.some(
          (r) => r.kind === "decision" && r.goalId === goal.id && r.status === "pending",
        )
      )
        throw new SuperAgentError({ reason: "invalid" });
      reportRunIds = [...new Set([...reportRunIds, op.runId])];
    }
    if (op.outcome === "ready" && changed && goal.status === "blocked") {
      const id = `goal-resume:${goal.id}:${fingerprint.slice(0, 24)}`;
      if (!continuations.some((c) => c.goalId === goal.id))
        continuations = [
          ...continuations,
          {
            id,
            goalId: goal.id,
            threadId: goal.workerThreadId!,
            ...(goal.workerEnvironmentId ? { environmentId: goal.workerEnvironmentId } : {}),
            text: `目标「${goal.title}」的外部恢复条件已查证：${goal.blocker!.condition}。\n依据：${op.summary}\n接续原任务：${goal.blocker!.continuation}`,
          },
        ];
    }
    records = records.map((r) =>
      r.id === goal.id
        ? {
            ...r,
            verification,
            updatedAt: now,
            status: op.outcome === "completed" ? "done" : r.status,
          }
        : r,
    );
    if (!observation.paused) {
      const deadlines = records
        .filter(isUnfinishedGoal)
        .map((g) =>
          g.verification
            ? Date.parse(g.verification.nextCheckAt)
            : Date.parse(now) + DEFAULT_GOAL_CHECK_MS,
        );
      observation = {
        ...observation,
        nextCheckAt: deadlines.length ? Math.min(...deadlines) : null,
      };
    }
  } else if (op.type === "summary") summary = op.text;
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
    if (
      actor === "agent" &&
      incoming.kind === "goal" &&
      incoming.status === "done" &&
      old?.status !== "done"
    )
      throw new SuperAgentError({ reason: "invalid" });
    if (
      actor === "agent" &&
      old?.blocker?.kind === "human" &&
      incoming.blocker?.kind !== "human" &&
      !records.some(
        (r) =>
          r.kind === "decision" &&
          r.goalId === old.id &&
          r.status === "answered" &&
          r.answer !== null,
      )
    )
      throw new SuperAgentError({ reason: "invalid" });
    if (old && old.kind !== incoming.kind) throw new SuperAgentError({ reason: "invalid" });
    if (actor === "agent" && incoming.answer !== null && old?.answer !== incoming.answer)
      throw new SuperAgentError({ reason: "invalid" });
    const { verification: _untrustedVerification, ...editable } = incoming;
    const updated = {
      ...editable,
      ...(!incoming.blocker && old?.blocker ? { blocker: old.blocker } : {}),
      ...(old?.verification ? { verification: old.verification } : {}),
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
    reportRunIds,
    continuations,
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
