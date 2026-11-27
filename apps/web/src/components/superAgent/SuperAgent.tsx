import { randomUUID } from "../../lib/utils";
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type ScopedThreadRef,
  type SuperAgentRecord,
  type SuperAgentMutation,
  isProviderAvailable,
} from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import { useState } from "react";
import {
  BotIcon,
  ListChecksIcon,
  RefreshCwIcon,
  PlusIcon,
  Trash2Icon,
  PencilIcon,
} from "lucide-react";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { useEnvironmentQuery } from "../../state/query";
import { Sheet, SheetPopup, SheetTitle } from "../ui/sheet";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogPopup, DialogTitle, DialogDescription } from "../ui/dialog";

export function SuperAgentLauncher({
  environmentId,
  onOpen,
}: {
  environmentId: EnvironmentId;
  onOpen: (ref: ScopedThreadRef) => unknown;
}) {
  const gt = useGT();
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const [error, setError] = useState(false);
  const ensure = useAtomCommand(serverEnvironment.ensureSuperAgent);
  const allowed = useAtomValue(serverEnvironment.ensureSuperAgent.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    const provider =
      providers?.find((p) => p.driver === "codex" && isProviderAvailable(p)) ??
      providers?.find(isProviderAvailable);
    const model = provider?.models.find((m) => m.isDefault) ?? provider?.models[0];
    const result = await ensure({
      environmentId,
      input:
        provider && model
          ? { modelSelection: { instanceId: provider.instanceId, model: model.slug } }
          : {},
    });
    setError(result._tag !== "Success");
    setBusy(false);
    if (result._tag === "Success" && result.value.threadId)
      onOpen({ environmentId, threadId: result.value.threadId });
  };
  return (
    <div className="px-3 py-2">
      <Button variant="ghost" size="sm" disabled={!allowed || busy} onClick={open}>
        <BotIcon />
        <span>
          <T>Super Agent</T>
        </span>
      </Button>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {gt("Super Agent could not open. Check the provider settings and retry.")}
        </p>
      ) : null}
    </div>
  );
}

export function SuperAgentPanel({ environmentId }: { environmentId: EnvironmentId }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden w-80 shrink-0 lg:block">
        <ManagerPanel environmentId={environmentId} />
      </div>
      <div className="fixed right-3 top-14 z-20 lg:hidden">
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
          <ListChecksIcon />
          <T>Goals</T>
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetPopup side="right">
          <SheetTitle className="sr-only">
            <T>Goals and decisions</T>
          </SheetTitle>
          <ManagerPanel environmentId={environmentId} />
        </SheetPopup>
      </Sheet>
    </>
  );
}
function ManagerPanel({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const [kind, setKind] = useState<"goal" | "decision" | "memory">("goal");
  const [search, setSearch] = useState("");
  const [cursor, setCursor] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [editRevision, setEditRevision] = useState(0);
  const [mutationFailed, setMutationFailed] = useState(false);
  const [editing, setEditing] = useState<SuperAgentRecord | "summary" | "new" | null>(null);
  const query = useEnvironmentQuery(
    serverEnvironment.superAgentLive({
      environmentId,
      input: { kind, search, cursor, limit: 10, includeCompleted: completed },
    }),
  );
  const update = useAtomCommand(serverEnvironment.updateSuperAgent);
  const review = useAtomCommand(serverEnvironment.reviewSuperAgent);
  const allowed = useAtomValue(serverEnvironment.updateSuperAgent.permissionAtom(environmentId));
  const snapshot = query.data;
  const mutate = async (operation: SuperAgentMutation["operation"], requestedRevision?: number) => {
    const revision = requestedRevision ?? snapshot?.revision;
    if (revision === undefined) return null;
    const result = await update({
      environmentId,
      input: { requestId: randomUUID(), expectedRevision: revision, operation },
    });
    setMutationFailed(result._tag !== "Success");
    return result;
  };
  const openEditor = (target: typeof editing) => {
    setEditRevision(snapshot?.revision ?? 0);
    setEditing(target);
  };
  const selectKind = (next: typeof kind) => {
    setKind(next);
    setCursor(0);
  };
  return (
    <aside
      className="flex h-dvh w-full max-w-full flex-col border-l bg-background"
      aria-label={gt("Goals and decisions")}
    >
      <header className="flex items-center justify-between border-b px-4 py-3 pr-12">
        <h2 className="text-sm font-medium">
          <T>Goals and decisions</T>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          title={gt("Review all sessions")}
          disabled={!allowed || snapshot?.storageAvailable === false}
          onClick={() => review({ environmentId, input: {} })}
        >
          <RefreshCwIcon />
        </Button>
      </header>
      <div className="flex gap-1 px-3 pt-3" role="tablist">
        {(
          [
            ["goal", gt("Goals")],
            ["decision", gt("Decisions")],
            ["memory", gt("Memory")],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            variant={kind === value ? "secondary" : "ghost"}
            size="sm"
            role="tab"
            aria-selected={kind === value}
            onClick={() => selectKind(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="flex gap-2 p-3">
        <Input
          aria-label={gt("Search manager records")}
          placeholder={gt("Search...")}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setCursor(0);
          }}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          title={gt("Add record")}
          disabled={!allowed || snapshot?.storageAvailable === false}
          onClick={() => openEditor("new")}
        >
          <PlusIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-gutter-both px-3 pb-4">
        {snapshot && !snapshot.storageAvailable ? (
          <p role="alert" className="text-sm text-destructive">
            {gt("Manager storage is unavailable. Existing files have been preserved.")}
          </p>
        ) : null}
        {mutationFailed ? (
          <p role="alert" className="text-sm text-destructive">
            {gt("Could not save. The record may have changed; reopen it and try again.")}
          </p>
        ) : null}
        {query.error ? (
          <p role="alert" className="text-sm text-destructive">
            {query.error}
          </p>
        ) : null}
        {snapshot && snapshot.pendingDeliveries > 0 ? (
          <p role="status" className="text-xs text-muted-foreground">
            {gt("Saved. Delivery is pending and will retry automatically.")}
          </p>
        ) : null}
        {kind === "memory" ? (
          <section className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">
                <T>Stable summary</T>
              </h3>
              <Button
                variant="ghost"
                size="icon-sm"
                title={gt("Edit summary")}
                disabled={!allowed || snapshot?.storageAvailable === false}
                onClick={() => openEditor("summary")}
              >
                <PencilIcon />
              </Button>
            </div>
            <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
              {snapshot?.summary || gt("No collaboration summary yet.")}
            </p>
          </section>
        ) : null}
        {snapshot?.records.map((record) => (
          <ManagerRecord
            key={record.id}
            record={record}
            environmentId={environmentId}
            disabled={!allowed || snapshot?.storageAvailable === false}
            onEdit={() => openEditor(record)}
            onDelete={() => mutate({ type: "delete", id: record.id })}
            onAnswer={(answer) => mutate({ type: "answer", id: record.id, answer })}
          />
        ))}
        {snapshot && !snapshot.records.length ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            <ListChecksIcon className="mx-auto mb-3 size-5" />
            <T>Nothing needs your attention here.</T>
          </div>
        ) : null}
      </div>
      <div className="border-t px-3 py-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={!allowed || snapshot?.storageAvailable === false}
          onClick={() =>
            mutate({ type: "plan", afterMinutes: snapshot?.nextCheckAt === null ? 5 : null })
          }
        >
          {snapshot?.nextCheckAt === null
            ? gt("Resume background reviews")
            : gt("Pause background reviews")}
        </Button>
      </div>
      <footer className="flex items-center justify-between gap-2 border-t p-3">
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={completed}
            onChange={(e) => {
              setCompleted(e.target.checked);
              setCursor(0);
            }}
          />
          <T>Include completed</T>
        </label>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={!cursor}
            onClick={() => setCursor(Math.max(0, cursor - 10))}
          >
            <T>Previous</T>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={snapshot?.nextCursor == null}
            onClick={() => setCursor(snapshot?.nextCursor ?? 0)}
          >
            <T>Next</T>
          </Button>
        </div>
      </footer>
      {editing !== null && snapshot ? (
        typeof editing === "object" ? (
          <ExistingRecordEditor
            environmentId={environmentId}
            id={editing.id}
            onClose={() => setEditing(null)}
            onSave={async (operation) => {
              const result = await mutate(operation, editRevision);
              if (result?._tag === "Success") setEditing(null);
              return result?._tag === "Success";
            }}
          />
        ) : (
          <RecordEditor
            key={editing}
            record={null}
            kind={kind}
            summary={editing === "summary" ? snapshot.summary : null}
            onClose={() => setEditing(null)}
            onSave={async (operation) => {
              const result = await mutate(operation, editRevision);
              if (result?._tag === "Success") setEditing(null);
              return result?._tag === "Success";
            }}
          />
        )
      ) : null}
    </aside>
  );
}

function ManagerRecord({
  record,
  environmentId,
  disabled,
  onEdit,
  onDelete,
  onAnswer,
}: {
  record: SuperAgentRecord;
  environmentId: EnvironmentId;
  disabled: boolean;
  onEdit: () => void;
  onDelete: () => unknown;
  onAnswer: (answer: string) => unknown;
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  const details = useEnvironmentQuery(
    expanded ? serverEnvironment.superAgentLive({ environmentId, input: { id: record.id } }) : null,
  );
  const shown = details.data?.records[0] ?? record;
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const send = async () => {
    setSending(true);
    await onAnswer(answer);
    setSending(false);
  };
  return (
    <article className="space-y-3 rounded-xl border p-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 break-words text-sm font-medium">{record.title}</h3>
        <div className="flex shrink-0">
          <Button
            variant="ghost"
            size="icon-xs"
            title={gt("Edit record")}
            disabled={disabled}
            onClick={onEdit}
          >
            <PencilIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            title={gt("Delete record")}
            disabled={disabled}
            onClick={onDelete}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
        {shown.content}
      </p>
      {record.content.length >= 300 ? (
        <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
          {expanded ? gt("Show less") : gt("View details")}
        </Button>
      ) : null}
      {details.error ? (
        <p role="alert" className="text-sm text-destructive">
          {details.error}
        </p>
      ) : null}
      {record.kind === "decision" && record.answer === null ? (
        <div className="space-y-2">
          {record.options.map((option) => (
            <Button
              key={option}
              variant={answer === option ? "secondary" : "outline"}
              size="sm"
              disabled={disabled || sending}
              onClick={() => setAnswer(option)}
            >
              {option}
            </Button>
          ))}
          <Textarea
            aria-label={gt("Your decision")}
            placeholder={gt("Add a decision or choose an option")}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <Button size="sm" disabled={disabled || sending || !answer.trim()} onClick={send}>
            <T>Send to Super Agent</T>
          </Button>
        </div>
      ) : record.answer ? (
        <p className="whitespace-pre-wrap break-words border-t pt-2 text-sm">{record.answer}</p>
      ) : (
        <p className="text-xs text-muted-foreground">{record.status}</p>
      )}
    </article>
  );
}

function RecordEditor({
  record,
  kind,
  summary,
  onClose,
  onSave,
}: {
  record: SuperAgentRecord | null;
  kind: SuperAgentRecord["kind"];
  summary: string | null;
  onClose: () => void;
  onSave: (op: SuperAgentMutation["operation"]) => Promise<boolean>;
}) {
  const gt = useGT();
  const [title, setTitle] = useState(record?.title ?? "");
  const [content, setContent] = useState(summary ?? record?.content ?? "");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [status, setStatus] = useState<SuperAgentRecord["status"]>(
    record?.status ?? (kind === "decision" ? "pending" : "active"),
  );
  const save = async () => {
    setSaving(true);
    if (summary !== null) setFailed(!(await onSave({ type: "summary", text: content })));
    else {
      const id = record?.id ?? randomUUID();
      setFailed(
        !(await onSave({
          type: "upsert",
          record: {
            id,
            kind,
            title,
            content,
            status,
            goalId: record?.goalId ?? null,
            dedupeKey: record?.dedupeKey ?? id,
            workerThreadId: record?.workerThreadId ?? null,
            ...(record?.workerEnvironmentId
              ? { workerEnvironmentId: record.workerEnvironmentId }
              : {}),
            options: record?.options ?? [],
            answer: record?.answer ?? null,
            updatedAt: new Date().toISOString(),
          },
        })),
      );
    }
    setSaving(false);
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogTitle>{summary !== null ? gt("Edit summary") : gt("Edit record")}</DialogTitle>
        <DialogDescription>
          <T>Changes are saved by this environment and shared with Super Agent.</T>
        </DialogDescription>
        <div className="space-y-3 py-4">
          {summary === null ? (
            <label className="flex items-center gap-3 text-sm">
              <T>Status</T>
              <select
                aria-label={gt("Status")}
                className="rounded-md border bg-background p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value as SuperAgentRecord["status"])}
              >
                {["active", "blocked", "pending", "answered", "done", "archived"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {summary === null ? (
            <Input
              aria-label={gt("Title")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={240}
            />
          ) : null}
          <Textarea
            aria-label={gt("Content")}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={10}
            maxLength={summary !== null ? 4000 : 12000}
          />
        </div>
        {failed ? (
          <p role="alert" className="text-sm text-destructive">
            {gt("Could not save. The record may have changed; reopen it and try again.")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            <T>Cancel</T>
          </Button>
          <Button disabled={saving || (summary === null && !title.trim())} onClick={save}>
            <T>Save</T>
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

function ExistingRecordEditor({
  environmentId,
  id,
  onClose,
  onSave,
}: {
  environmentId: EnvironmentId;
  id: string;
  onClose: () => void;
  onSave: (op: SuperAgentMutation["operation"]) => Promise<boolean>;
}) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    serverEnvironment.superAgentLive({ environmentId, input: { id } }),
  );
  const record = query.data?.records[0];
  return record ? (
    <RecordEditor
      key={record.id}
      record={record}
      kind={record.kind}
      summary={null}
      onClose={onClose}
      onSave={onSave}
    />
  ) : (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup>
        <DialogTitle>{gt("Edit record")}</DialogTitle>
        <DialogDescription>{query.error ?? gt("Loading record...")}</DialogDescription>
        <Button variant="ghost" onClick={onClose}>
          <T>Cancel</T>
        </Button>
      </DialogPopup>
    </Dialog>
  );
}
