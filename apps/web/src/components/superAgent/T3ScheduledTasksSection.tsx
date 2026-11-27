import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { T, useGT, useMessages, useLocale } from "gt-react";
import { useNavigate } from "@tanstack/react-router";
import { type EnvironmentId, type ScheduledTask } from "@t3tools/contracts";
import { ChevronRightIcon, ArrowLeftIcon } from "lucide-react";
import { useEnvironments } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useClientSettings } from "../../hooks/useSettings";
import { formatDateTimeTimestamp } from "../../timestampFormat";
import { scheduleLabel } from "../settings/scheduledTasksSettings.logic";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";

export function T3ScheduledTasksSection({
  environmentId,
  search,
  onNavigate,
}: {
  environmentId: EnvironmentId;
  search: string;
  onNavigate: () => void;
}) {
  const gt = useGT();
  const { environments } = useEnvironments();
  const entries = environments.some((e) => e.environmentId === environmentId)
    ? environments
    : [
        { environmentId, label: gt("This environment"), connection: { phase: "connected" } },
        ...environments,
      ];
  return (
    <section className="space-y-3" aria-label={gt("T3 native schedules")}>
      <h3 className="text-xs font-medium text-muted-foreground">
        <T>T3 native</T>
      </h3>
      {entries
        .toSorted(
          (a, b) =>
            Number(b.environmentId === environmentId) - Number(a.environmentId === environmentId),
        )
        .map((entry) => (
          <EnvironmentTasks
            key={entry.environmentId}
            environmentId={entry.environmentId}
            label={entry.label}
            connected={entry.connection.phase === "connected"}
            search={search}
            onNavigate={onNavigate}
          />
        ))}
    </section>
  );
}
function EnvironmentTasks({
  environmentId,
  label,
  connected,
  search,
  onNavigate,
}: {
  environmentId: EnvironmentId;
  label: string;
  connected: boolean;
  search: string;
  onNavigate: () => void;
}) {
  const gt = useGT();
  const messages = useMessages();
  const locale = useLocale();
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const query = useEnvironmentQuery(
    connected ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  const [page, setPage] = useState(0);
  const [lastSearch, setLastSearch] = useState(search);
  if (lastSearch !== search) {
    setLastSearch(search);
    setPage(0);
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const toggle = useAtomCommand(serverEnvironment.setScheduledTaskEnabled);
  const run = useAtomCommand(serverEnvironment.runScheduledTaskNow);
  const remove = useAtomCommand(serverEnvironment.deleteScheduledTask);
  const allowed = useAtomValue(
    serverEnvironment.setScheduledTaskEnabled.permissionAtom(environmentId),
  );
  const canRun = useAtomValue(serverEnvironment.runScheduledTaskNow.permissionAtom(environmentId));
  const canDelete = useAtomValue(
    serverEnvironment.deleteScheduledTask.permissionAtom(environmentId),
  );
  const navigate = useNavigate();
  const tasks = query.data?.tasks ?? [];
  const selected = tasks.find((task) => task.id === selectedId);
  const needle = search.trim().toLocaleLowerCase();
  const filtered = tasks.filter(
    (task) =>
      !needle ||
      [task.title, task.prompt, task.id, label].some((s) => s.toLocaleLowerCase().includes(needle)),
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 10) - 1));
  const shown = filtered.slice(currentPage * 10, currentPage * 10 + 10);
  const time = (value: string) => formatDateTimeTimestamp(value, timestampFormat);
  const status = (task: ScheduledTask) =>
    task.blockedByPolicy ??
    (task.lastRunStatus === "running"
      ? gt("Running")
      : !task.enabled
        ? gt("Paused")
        : task.schedule.type === "webhook"
          ? gt("Listening")
          : task.nextRunAt
            ? gt("Scheduled")
            : gt("Not scheduled"));
  const lastStatus = (task: ScheduledTask) =>
    ({
      never: gt("Never run"),
      running: gt("Running"),
      succeeded: gt("Succeeded"),
      failed: gt("Failed"),
    })[task.lastRunStatus];
  const edit = (task?: ScheduledTask) => {
    onNavigate();
    void navigate({
      to: "/settings/scheduled-tasks",
      search: {
        environmentId,
        ...(task ? { taskId: task.id } : {}),
        machine: environmentId,
        project: undefined,
        checkout: undefined,
      },
    });
  };
  const act = async (task: ScheduledTask, action: "toggle" | "run" | "delete") => {
    if (
      busy ||
      !connected ||
      !(action === "toggle" ? allowed : action === "run" ? canRun : canDelete)
    )
      return;
    setBusy(true);
    setFeedback(null);
    const result =
      action === "toggle"
        ? await toggle({ environmentId, input: { id: task.id, enabled: !task.enabled } })
        : action === "run"
          ? await run({ environmentId, input: { id: task.id } })
          : await remove({ environmentId, input: { id: task.id } });
    setBusy(false);
    if (result._tag !== "Success") {
      setFeedback(gt("Could not confirm this change. Refresh before retrying."));
      return;
    }
    setFeedback(
      action === "run"
        ? gt("Run requested. Follow its status and linked session for the result.")
        : gt("T3 confirmed the task change."),
    );
    if (action === "delete") {
      setSelectedId(null);
      setDeleting(null);
    }
  };
  return (
    <section className="min-w-0 space-y-2" aria-label={label} data-t3-schedules>
      <div className="flex items-center justify-between gap-2">
        <h4 className="truncate text-xs text-muted-foreground">{label}</h4>
        <Button size="sm" variant="ghost" disabled={!connected || !allowed} onClick={() => edit()}>
          <T>Manage</T>
        </Button>
      </div>
      {!connected ? (
        <p role="status" className="text-xs text-muted-foreground">
          <T>Environment offline. Its native schedules could not be checked.</T>
        </p>
      ) : query.error ? (
        <p role="alert" className="break-words text-xs text-destructive">
          {query.error}
        </p>
      ) : !query.data ? (
        <p role="status" className="text-xs text-muted-foreground">
          <T>Loading native T3 schedules...</T>
        </p>
      ) : selected ? (
        <article className="space-y-3 rounded-xl border p-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
            <ArrowLeftIcon />
            <T>All T3 schedules</T>
          </Button>
          <h4 className="break-words text-sm font-medium">{selected.title}</h4>
          <Badge variant="outline">{status(selected)}</Badge>
          <p className="text-xs text-muted-foreground">
            {scheduleLabel(
              selected.schedule,
              timestampFormat,
              query.data.timeZone,
              selected.nextRunAt,
              messages,
              locale,
            )}
          </p>
          <p className="whitespace-pre-wrap break-words text-sm">{selected.prompt}</p>
          {selected.nextRunAt ? (
            <p className="text-xs text-muted-foreground">
              <T>Next run</T> {time(selected.nextRunAt)}
            </p>
          ) : null}
          {selected.lastRunAt ? (
            <p className="text-xs text-muted-foreground">
              <T>Last run</T> {time(selected.lastRunAt)} · {lastStatus(selected)}
            </p>
          ) : null}
          {selected.lastRunError ? (
            <p role="status" className="break-words text-xs text-destructive">
              {selected.lastRunError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !allowed}
              onClick={() => act(selected, "toggle")}
            >
              {selected.enabled ? gt("Pause schedule") : gt("Resume schedule")}
            </Button>
            {selected.schedule.type !== "webhook" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !canRun || selected.lastRunStatus === "running"}
                onClick={() => act(selected, "run")}
              >
                <T>Run now</T>
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !allowed}
              onClick={() => edit(selected)}
            >
              <T>Edit in T3 settings</T>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || !canDelete || selected.lastRunStatus === "running"}
              onClick={() => setDeleting(selected)}
            >
              <T>Delete</T>
            </Button>
          </div>
        </article>
      ) : (
        <>
          {shown.map((task) => (
            <article key={task.id} className="min-w-0 space-y-2 rounded-xl border p-3">
              <Button
                variant="ghost"
                className="h-auto w-full justify-between whitespace-normal text-left"
                onClick={() => {
                  setSelectedId(task.id);
                  setFeedback(null);
                }}
              >
                <span className="min-w-0 break-words">{task.title}</span>
                <ChevronRightIcon className="shrink-0" />
              </Button>
              <Badge variant="outline">{status(task)}</Badge>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {scheduleLabel(
                  task.schedule,
                  timestampFormat,
                  query.data?.timeZone,
                  task.nextRunAt,
                  messages,
                  locale,
                )}
              </p>
              {task.nextRunAt ? (
                <p className="text-xs text-muted-foreground">
                  <T>Next run</T> {time(task.nextRunAt)}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {lastStatus(task)}
                {task.lastRunAt ? ` · ${time(task.lastRunAt)}` : ""}
              </p>
            </article>
          ))}
          {!shown.length ? (
            <p className="py-2 text-xs text-muted-foreground">
              {search
                ? gt("No matching native T3 schedules.")
                : gt("No native T3 schedules in this environment.")}
            </p>
          ) : null}
          {filtered.length > 10 ? (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                <T>Previous</T>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={(currentPage + 1) * 10 >= filtered.length}
                onClick={() => setPage(currentPage + 1)}
              >
                <T>Next</T>
              </Button>
            </div>
          ) : null}
        </>
      )}
      {feedback ? (
        <p role="status" className="text-xs text-muted-foreground">
          {feedback}
        </p>
      ) : null}
      <Dialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogPopup>
          <DialogTitle>
            <T>Delete this T3 schedule?</T>
          </DialogTitle>
          <DialogDescription>
            <T>This removes the schedule from T3. Existing sessions and history are kept.</T>
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              <T>Cancel</T>
            </Button>
            <Button
              disabled={busy || !canDelete}
              onClick={() => {
                if (deleting) void act(deleting, "delete");
              }}
            >
              <T>Delete</T>
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </section>
  );
}
