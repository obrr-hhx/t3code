import { T3ScheduledTasksSection } from "./T3ScheduledTasksSection";
import { Atom } from "effect/reactivity";
import { useState } from "react";
import { useAtomValue, useAtom } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ForgeCronSession,
  type ForgeLegacySchedule,
  type ForgeCronMutation,
} from "@t3tools/contracts";
import { useGT, T } from "gt-react";
import {
  Clock3Icon,
  RefreshCwIcon,
  ChevronRightIcon,
  ServerIcon,
  ArrowLeftIcon,
} from "lucide-react";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { randomUUID } from "../../lib/utils";
import { formatDateTimeTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";

type NativeSession = typeof ForgeCronSession.Type;
type LegacySchedule = typeof ForgeLegacySchedule.Type;
type Selected =
  | { type: "native"; session: NativeSession }
  | { type: "legacy"; record: LegacySchedule };
const date = (value: string) => formatDateTimeTimestamp(value, "locale") || value;

const cronPanelEnvironment = Atom.make<EnvironmentId | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("web-forge-cron-panel"),
);
export function ForgeCronLauncher({ environmentId }: { environmentId: EnvironmentId }) {
  const [, open] = useAtom(cronPanelEnvironment);
  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-9 w-full justify-start"
      onClick={() => open(environmentId)}
    >
      <Clock3Icon className="size-4 text-icon-muted" />
      <T>Scheduled sessions</T>
    </Button>
  );
}
export function ForgeCronSurface() {
  const [environmentId, setEnvironmentId] = useAtom(cronPanelEnvironment);
  return (
    <Sheet
      open={environmentId !== null}
      onOpenChange={(open) => {
        if (!open) setEnvironmentId(null);
      }}
    >
      <SheetPopup side="right">
        <SheetTitle className="sr-only">
          <T>Scheduled sessions</T>
        </SheetTitle>
        {environmentId ? (
          <ForgeCronPanel key={environmentId} environmentId={environmentId} standalone />
        ) : null}
      </SheetPopup>
    </Sheet>
  );
}

function ForgeCronPanel({
  environmentId,
  standalone = false,
}: {
  environmentId: EnvironmentId;
  standalone?: boolean;
}) {
  const gt = useGT();
  const [, setPanelEnvironment] = useAtom(cronPanelEnvironment);
  const [source, setSource] = useState<"all" | "legacy" | "native" | "t3">("all");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [legacyCursors, setLegacyCursors] = useState<string[]>([]);
  const [selected, setSelected] = useState<Selected | null>(null);
  const legacy = useEnvironmentQuery(
    serverEnvironment.forgeCron({
      environmentId,
      input: { view: "legacy", search, limit: 20, cursor: legacyCursors.at(-1) },
    }),
  );
  const native = useEnvironmentQuery(
    serverEnvironment.forgeCron({
      environmentId,
      input: { view: "list", search, limit: 10, cursor: cursors.at(-1) },
    }),
  );
  const refresh = () => {
    legacy.refresh();
    native.refresh();
  };
  const actor = legacy.data ?? native.data;
  const empty = !legacy.data?.legacy?.length && !native.data?.sessions?.length;
  return (
    <section
      className="flex min-h-0 flex-1 flex-col overflow-hidden"
      aria-label={gt("Scheduled sessions")}
    >
      <header
        className={`flex min-h-12 shrink-0 items-center gap-2 border-b px-3 ${standalone ? "pr-12" : ""}`}
      >
        <Clock3Icon className="size-4 text-icon-muted" />
        <h2 className="min-w-0 flex-1 text-sm font-medium">
          <T>Scheduled sessions</T>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={gt("Refresh scheduled sessions")}
          disabled={legacy.isPending || native.isPending}
          onClick={refresh}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      {selected ? (
        <CronDetails
          key={selected.type === "legacy" ? selected.record.sessionId : selected.session.id}
          environmentId={environmentId}
          selected={selected}
          onBack={() => {
            setSelected(null);
            refresh();
          }}
        />
      ) : (
        <>
          <div className="shrink-0 space-y-3 border-b p-3">
            <p className="truncate text-xs text-muted-foreground">
              {actor?.actor ?? gt("Local and remote schedules")}
            </p>
            <Input
              aria-label={gt("Search scheduled sessions")}
              placeholder={gt("Search scheduled sessions...")}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setCursors([]);
                setLegacyCursors([]);
              }}
            />
            <div className="flex flex-wrap gap-1" role="tablist" aria-label={gt("Schedule source")}>
              {(
                [
                  ["all", gt("All")],
                  ["t3", gt("T3 native")],
                  ["legacy", gt("VM schedules")],
                  ["native", gt("Forge cron")],
                ] as const
              ).map(([value, label]) => (
                <Button
                  key={value}
                  variant={source === value ? "secondary" : "ghost"}
                  size="sm"
                  role="tab"
                  aria-selected={source === value}
                  onClick={() => setSource(value)}
                >
                  {label}
                </Button>
              ))}
            </div>
          </div>
          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-3"
            data-cron-list
          >
            {source !== "t3" && (legacy.error || native.error) ? (
              <p role="alert" className="break-words text-sm text-destructive">
                {legacy.error ?? native.error}
              </p>
            ) : null}
            {source !== "t3" && !actor && (legacy.isPending || native.isPending) ? (
              <p role="status" className="text-sm text-muted-foreground">
                <T>Loading schedules...</T>
              </p>
            ) : null}
            {source === "all" || source === "t3" ? (
              <T3ScheduledTasksSection
                environmentId={environmentId}
                search={search}
                onNavigate={() => setPanelEnvironment(null)}
              />
            ) : null}
            {source === "all" || source === "legacy" ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  <T>VM schedules</T>
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <T>
                    Existing crontab and systemd plans. Status shows the last verification, not
                    proof of a new run.
                  </T>
                </p>
                {legacy.data?.legacy?.map((record) => (
                  <ScheduleCard
                    key={record.sessionId}
                    name={record.name}
                    environment={record.environmentId}
                    expression={record.expression}
                    timezone={record.timezone}
                    status={
                      record.enabled ? gt("Last verified: enabled") : gt("Last verified: paused")
                    }
                    onOpen={() => setSelected({ type: "legacy", record })}
                  >
                    <span>
                      <T>Verified</T> {date(record.verifiedAt)}
                    </span>
                  </ScheduleCard>
                ))}
                {legacy.data && !legacy.data.legacy?.length ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    <T>No matching VM schedules.</T>
                  </p>
                ) : null}
                {legacyCursors.length || legacy.data?.nextCursor ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!legacyCursors.length}
                      onClick={() => setLegacyCursors(legacyCursors.slice(0, -1))}
                    >
                      <T>Previous</T>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!legacy.data?.nextCursor}
                      onClick={() => {
                        const cursor = legacy.data?.nextCursor;
                        if (cursor) setLegacyCursors([...legacyCursors, cursor]);
                      }}
                    >
                      <T>Next</T>
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {source === "all" || source === "native" ? (
              <section className="space-y-2">
                <h3 className="text-xs font-medium text-muted-foreground">
                  <T>Forge cron</T>
                </h3>
                {native.data?.sessions?.map((session) => (
                  <ScheduleCard
                    key={session.id}
                    name={session.name}
                    environment={session.environmentId}
                    expression={session.schedule?.expression ?? gt("Child session")}
                    timezone={session.schedule?.timezone ?? ""}
                    status={
                      !session.schedule
                        ? gt("Child session")
                        : !session.schedule.enabled
                          ? gt("Paused")
                          : !session.schedule.schedulerEnabled
                            ? gt("Server automation disabled")
                            : gt("Scheduled")
                    }
                    onOpen={() => setSelected({ type: "native", session })}
                  >
                    {session.schedule?.enabled ? (
                      <span>
                        <T>Next run</T> {date(session.schedule.nextRunAt)}
                      </span>
                    ) : null}
                  </ScheduleCard>
                ))}
                {native.data && !native.data.sessions?.length ? (
                  <p className="py-3 text-sm text-muted-foreground">
                    <T>
                      No matching native Forge cron sessions. VM schedules are listed separately.
                    </T>
                  </p>
                ) : null}
                {native.data?.warning ? (
                  <p role="status" className="text-xs text-muted-foreground">
                    {native.data.warning}
                  </p>
                ) : null}
                {cursors.length || native.data?.nextCursor ? (
                  <div className="flex justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!cursors.length}
                      onClick={() => setCursors(cursors.slice(0, -1))}
                    >
                      <T>Previous</T>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!native.data?.nextCursor}
                      onClick={() => {
                        const cursor = native.data?.nextCursor;
                        if (cursor) setCursors([...cursors, cursor]);
                      }}
                    >
                      <T>Next</T>
                    </Button>
                  </div>
                ) : null}
              </section>
            ) : null}
            {source !== "t3" && source !== "all" && actor && empty && search ? (
              <p className="text-xs text-muted-foreground">
                <T>Try a session name or VM ID.</T>
              </p>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}
function ScheduleCard({
  name,
  environment,
  expression,
  timezone,
  status,
  onOpen,
  children,
}: {
  name: string;
  environment: string;
  expression: string;
  timezone: string;
  status: string;
  onOpen: () => void;
  children?: React.ReactNode;
}) {
  return (
    <article className="min-w-0 space-y-3 rounded-xl border p-3">
      <Button
        variant="ghost"
        className="h-auto w-full justify-between whitespace-normal text-left"
        onClick={onOpen}
      >
        <span className="min-w-0 break-words">{name}</span>
        <ChevronRightIcon className="shrink-0" />
      </Button>
      <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <ServerIcon className="size-3 shrink-0" />
        <span className="truncate">{environment}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="break-all text-xs">{expression}</code>
        <span className="text-xs text-muted-foreground">{timezone}</span>
      </div>
      <Badge variant="outline">{status}</Badge>
      <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
    </article>
  );
}
function CronDetails({
  environmentId,
  selected,
  onBack,
}: {
  environmentId: EnvironmentId;
  selected: Selected;
  onBack: () => void;
}) {
  const gt = useGT();
  const id = selected.type === "legacy" ? selected.record.sessionId : selected.session.id;
  const title = selected.type === "legacy" ? selected.record.name : selected.session.name;
  const detail = useEnvironmentQuery(
    serverEnvironment.forgeCron({ environmentId, input: { view: "detail", sessionId: id } }),
  );
  const [historyType, setHistoryType] = useState<"wakeups" | "results">(
    selected.type === "legacy" ? "results" : "wakeups",
  );
  const [historyCursors, setHistoryCursors] = useState<string[]>([]);
  const history = useEnvironmentQuery(
    serverEnvironment.forgeCron({
      environmentId,
      input: { view: historyType, sessionId: id, cursor: historyCursors.at(-1) },
    }),
  );
  const command = useAtomCommand(serverEnvironment.manageForgeCron);
  const allowed = useAtomValue(serverEnvironment.manageForgeCron.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [retiring, setRetiring] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const schedule = detail.data?.schedule;
  const mutate = async (change: ForgeCronMutation) => {
    setBusy(true);
    setFeedback(null);
    if (change.operation === "delegateLegacy") setRequestId(change.requestId);
    const result = await command({ environmentId, input: change });
    setBusy(false);
    if (result._tag !== "Success") {
      setFeedback(gt("Could not confirm this change. Refresh before retrying."));
      return;
    }
    const value = result.value;
    setFeedback(
      value.warning ??
        (value.receipt
          ? gt("Sent to Forge Agent. Delivery is not completion; check progress below.")
          : gt("Forge confirmed the schedule change.")),
    );
    if (change.operation === "delegateLegacy") setRequestId(change.requestId);
    detail.refresh();
    history.refresh();
    setRetiring(false);
  };
  return (
    <div
      className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-3"
      data-cron-details
    >
      <Button size="sm" variant="ghost" onClick={onBack}>
        <ArrowLeftIcon />
        <T>All schedules</T>
      </Button>
      <h3 className="break-words text-base font-medium">{title}</h3>
      <p className="break-all text-xs text-muted-foreground">{id}</p>
      {detail.error ? (
        <p role="alert" className="break-words text-sm text-destructive">
          {detail.error}
        </p>
      ) : null}
      {selected.type === "legacy" ? (
        <div className="space-y-3 rounded-xl border p-3">
          <Badge variant="outline">
            <T>VM schedule</T>
          </Badge>
          <p className="text-sm">
            <code>{selected.record.expression}</code> · {selected.record.timezone}
          </p>
          <p className="break-all font-mono text-xs text-muted-foreground">
            {selected.record.scriptPath}
          </p>
          <p className="text-xs text-muted-foreground">
            <T>Last verified</T> {date(selected.record.verifiedAt)}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            <T>
              This plan runs inside its VM. Pausing a native Forge cron will not stop it. Ask Forge
              Agent to verify or change the existing plan.
            </T>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!allowed || busy || requestId !== null}
            onClick={() =>
              mutate({
                operation: "delegateLegacy",
                requestId: randomUUID(),
                // oxlint-disable-next-line t3code/no-untranslated-copy -- Agent task text, not displayed UI.
                message: `请只读核对现有 VM 定时任务 ${selected.record.name}（session ${id}，VM ${selected.record.environmentId}，脚本 ${selected.record.scriptPath}）：最近一次运行时间、执行结果、日志或报告位置，以及当前计划是否启用。返回可核验的摘要。本次不修改调度或启动业务任务。`,
              })
            }
          >
            <T>Check recent runs</T>
          </Button>
        </div>
      ) : schedule ? (
        <div className="space-y-3 rounded-xl border p-3">
          <p className="text-sm">
            <code>{schedule.expression}</code> · {schedule.timezone}
          </p>
          <p className="text-xs text-muted-foreground">
            <T>Next run</T> {date(schedule.nextRunAt)}
          </p>
          {!schedule.schedulerEnabled ? (
            <p role="status" className="text-xs text-destructive">
              <T>Forge server automation is disabled.</T>
            </p>
          ) : null}
          <p className="whitespace-pre-wrap break-words text-sm">{detail.data?.prompt}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() =>
                mutate({
                  operation: schedule.enabled ? "pause" : "resume",
                  sessionId: id,
                  expectedRevision: schedule.revision,
                })
              }
            >
              {schedule.enabled ? gt("Pause schedule") : gt("Resume schedule")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!allowed || busy}
              onClick={() => setRetiring(true)}
            >
              <T>Retire session</T>
            </Button>
          </div>
        </div>
      ) : null}
      {feedback ? (
        <p role="status" className="break-words text-sm text-muted-foreground">
          {feedback}
        </p>
      ) : null}
      {requestId ? (
        <ForgeAgentProgress key={requestId} environmentId={environmentId} requestId={requestId} />
      ) : null}
      {detail.data?.session?.progress ? (
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          {detail.data.session.progress}
        </p>
      ) : null}
      <div className="flex gap-1" role="tablist" aria-label={gt("Run evidence")}>
        {(
          [
            ["results", gt("Results")],
            ["wakeups", gt("Deliveries")],
          ] as const
        )
          .filter(([v]) => selected.type === "native" || v === "results")
          .map(([value, label]) => (
            <Button
              key={value}
              role="tab"
              size="sm"
              variant={historyType === value ? "secondary" : "ghost"}
              aria-selected={historyType === value}
              onClick={() => {
                setHistoryType(value);
                setHistoryCursors([]);
              }}
            >
              {label}
            </Button>
          ))}
      </div>
      {history.error ? (
        <p role="alert" className="break-words text-xs text-destructive">
          {history.error}
        </p>
      ) : null}
      {history.data?.wakeups?.map((w) => (
        <article key={w.requestId} className="space-y-1 rounded-lg border p-3 text-xs">
          <p>{date(w.scheduledAt)}</p>
          <p>
            {w.state} · {w.outcome ?? gt("No result yet")}
          </p>
          {w.reason ? <p className="break-words text-muted-foreground">{w.reason}</p> : null}
        </article>
      ))}
      {history.data?.results?.map((r) => (
        <article key={r.eventId} className="space-y-2 rounded-lg border p-3 text-xs">
          <p>
            {date(r.occurredAt)} · {r.outcome}
          </p>
          <p className="whitespace-pre-wrap break-words leading-relaxed">
            {r.resultText || gt("No result text available.")}
          </p>
        </article>
      ))}
      {history.data && !history.data.results?.length && !history.data.wakeups?.length ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {selected.type === "legacy"
            ? gt("No Forge result records. VM script logs are separate; use Check recent runs.")
            : gt("No run records yet.")}
        </p>
      ) : null}
      <div className="flex justify-end gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!historyCursors.length}
          onClick={() => setHistoryCursors(historyCursors.slice(0, -1))}
        >
          <T>Previous</T>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!history.data?.nextCursor}
          onClick={() => {
            const cursor = history.data?.nextCursor;
            if (cursor) setHistoryCursors([...historyCursors, cursor]);
          }}
        >
          <T>Next</T>
        </Button>
      </div>
      <Dialog open={retiring} onOpenChange={setRetiring}>
        <DialogPopup>
          <DialogTitle>
            <T>Retire this scheduled session?</T>
          </DialogTitle>
          <DialogDescription>
            <T>
              Pause future inputs, close this session and archive it. History and the VM remain
              available.
            </T>
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRetiring(false)}>
              <T>Cancel</T>
            </Button>
            <Button
              disabled={busy || !schedule}
              onClick={() => {
                if (schedule)
                  void mutate({
                    operation: "retire",
                    sessionId: id,
                    expectedRevision: schedule.revision,
                  });
              }}
            >
              <T>Retire session</T>
            </Button>
          </div>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
function ForgeAgentProgress({
  environmentId,
  requestId,
}: {
  environmentId: EnvironmentId;
  requestId: string;
}) {
  const gt = useGT();
  const receipt = useEnvironmentQuery(
    serverEnvironment.forgeCron({ environmentId, input: { view: "agentReceipt", requestId } }),
  );
  const conversation = useEnvironmentQuery(
    receipt.data?.receipt?.turnId
      ? serverEnvironment.forgeCron({
          environmentId,
          input: { view: "agentConversation", turnId: receipt.data.receipt.turnId },
        })
      : null,
  );
  return (
    <section className="space-y-2 rounded-lg border p-3" aria-label={gt("Forge Agent progress")}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">
          <T>Forge Agent progress</T>
        </h4>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label={gt("Refresh Forge Agent progress")}
          onClick={() => {
            receipt.refresh();
            conversation.refresh();
          }}
        >
          <RefreshCwIcon />
        </Button>
      </div>
      {receipt.error || conversation.error ? (
        <p role="alert" className="break-words text-xs text-destructive">
          {receipt.error ?? conversation.error}
        </p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        {receipt.data?.receipt?.status ?? gt("Waiting for receipt...")}
      </p>
      {conversation.data?.messages
        ?.filter((m) => m.role === "assistant")
        .map((m) => (
          <p
            key={m.id ?? `${m.turnId}:${m.text}`}
            className="whitespace-pre-wrap break-words text-sm leading-relaxed"
          >
            {m.text}
          </p>
        ))}
    </section>
  );
}
