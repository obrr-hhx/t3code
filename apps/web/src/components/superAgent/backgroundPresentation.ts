import type { RunId } from "@t3tools/contracts";
import type { TimelineEntry } from "../../session-logic";

/** Preserve the transcript; hide internal review prompts and successful turns with no report. */
export function visibleManagerReviews(
  entries: ReadonlyArray<TimelineEntry>,
  runIdOf: (entry: TimelineEntry) => RunId | null,
  failedRuns: ReadonlySet<RunId>,
): ReadonlyArray<TimelineEntry> {
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
  return entries.filter((entry) => {
    if (internal(entry)) return false;
    const runId = runIdOf(entry);
    return !runId || !finishedEmpty.has(runId) || substantive.has(runId) || failedRuns.has(runId);
  });
}
