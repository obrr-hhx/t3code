import type { RunId } from "@t3tools/contracts";
import type { TimelineEntry } from "../../session-logic";

export interface ManagerReportPolicy {
  readonly since: string;
  readonly allowed: ReadonlySet<RunId>;
}

/** Approval queries cover changing windows; a pending/new window must not revoke earlier results. */
export function retainManagerReportPolicy(
  previous: ManagerReportPolicy | undefined,
  snapshot: {
    readonly reportPolicyAt?: string | undefined;
    readonly reportRunIds?: ReadonlyArray<RunId> | undefined;
  } | null,
): ManagerReportPolicy | undefined {
  if (!snapshot?.reportPolicyAt) return previous;
  const allowed = snapshot.reportRunIds ?? [];
  if (previous?.since === snapshot.reportPolicyAt) {
    if (allowed.every((id) => previous.allowed.has(id))) return previous;
    return { since: previous.since, allowed: new Set([...previous.allowed, ...allowed]) };
  }
  return { since: snapshot.reportPolicyAt, allowed: new Set(allowed) };
}

// The timeline compares input identity while restoring scroll/disclosure state. Keep the
// filtered view stable for unchanged immutable entries and the same disclosure policy.
const views = new WeakMap<
  ReadonlyArray<TimelineEntry>,
  { key: string; value: ReadonlyArray<TimelineEntry> }
>();
/** Preserve the transcript; hide internal review prompts and successful turns with no report. */
export function visibleManagerReviews(
  entries: ReadonlyArray<TimelineEntry>,
  runIdOf: (entry: TimelineEntry) => RunId | null,
  failedRuns: ReadonlySet<RunId>,
  policy?: ManagerReportPolicy,
): ReadonlyArray<TimelineEntry> {
  const key = JSON.stringify([
    [...failedRuns].sort(),
    policy?.since,
    [...(policy?.allowed ?? [])].sort(),
  ]);
  const cached = views.get(entries);
  if (cached?.key === key) return cached.value;
  const internal = (entry: TimelineEntry) =>
    entry.kind === "message" &&
    entry.message.role === "user" &&
    entry.message.createdBy === "system" &&
    entry.message.creationSource === "server" &&
    entry.message.id.startsWith("super-agent-observe:");
  const runs = new Set(
    entries.filter(internal).flatMap((entry) => {
      const id = entry.kind === "message" ? entry.message.runId : runIdOf(entry);
      return id ? [id] : [];
    }),
  );
  if (!runs.size) return entries;
  const substantive = new Set<RunId>();
  const finishedEmpty = new Set<RunId>();
  for (const entry of entries) {
    const runId = runIdOf(entry);
    if (!runId || !runs.has(runId)) continue;
    if (entry.kind === "message" && entry.message.role === "assistant") {
      if (entry.message.text.trim()) substantive.add(runId);
      else if (!entry.message.streaming) finishedEmpty.add(runId);
    } else if (
      entry.kind === "sent-message" ||
      entry.kind === "html-render" ||
      entry.kind === "mcp-app" ||
      entry.kind === "proposed-plan"
    )
      substantive.add(runId);
  }
  const value = entries.filter((entry) => {
    if (internal(entry)) return false;
    const runId = runIdOf(entry);
    if (!runId || !runs.has(runId)) return true;
    if (failedRuns.has(runId)) return true;
    const prompt = entries.find(
      (e) => internal(e) && (e.kind === "message" ? e.message.runId : runIdOf(e)) === runId,
    );
    if (policy && prompt && prompt.createdAt >= policy.since && !policy.allowed.has(runId))
      return false;
    if (
      entry.kind === "message" &&
      entry.message.role === "assistant" &&
      isReviewNoise(entry.message.text)
    )
      return false;
    return !finishedEmpty.has(runId) || substantive.has(runId);
  });
  views.set(entries, { key, value });
  return value;
}

/** Applied only to background reviews; ordinary user questions always retain their answers. */
function isReviewNoise(text: string): boolean {
  const value = text.trim();
  return /^(?:[（(]后台巡检[:：][\s\S]*[）)]|(?:无新增变化|暂无进展|暂无新增需汇报事项|继续静默等待)[。.!！]?|(?:No (?:changes|updates|new results)[.!]?))$/i.test(
    value,
  );
}
