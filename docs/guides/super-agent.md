# Super Agent in this fork

Super Agent is a persistent coordinator for T3 Code threads. It uses the existing
conversation UI, provider adapters, queued/steered follow-ups, and peer links.
It does not relay terminal screens or introduce a second chat renderer.

## Start

1. Configure a coding provider in Settings. Open **Super Agent** at the top of the sidebar.
   Codex is preferred; another available provider can start it when Codex is unavailable.
2. Use the ordinary composer model picker to change its provider, model, or effort.
   Workers keep their own selections.
3. Describe an outcome and its authorization. The coordinator discovers existing threads,
   continues appropriate workers, and records goals and evidence in the right panel.
4. Answer a decision card in the panel. The answer is saved before delivery and queued
   into the same coordinator conversation. Pending delivery is shown and retried with
   the same native command identity, including after a server restart.

**Review all sessions** requests an explicit review. **Pause background reviews** and
**Resume background reviews** pause/resume both timed inspections and worker-change wakes.
While enabled, a new result or question wakes the coordinator. The coordinator can
choose its next check time through `super_agent_update`. Unfinished goals retain a fallback
inspection when no time is chosen; only an explicit user pause stops background reviews.
Successful background turns with no report and their internal prompts stay out of the
conversation view; substantive reports and failed runs remain visible. The original
transcript remains available through T3’s history tools.

Checks use server time and continue while the backend is running, even if the UI is closed.
A stopped backend cannot send a reminder.

The server inspects thread status once a minute without calling a model. Unchanged
observations do not produce another turn. A goal worker with no progress for twenty
minutes can trigger one review when the coordinator's selected check time is due;
the same unchanged stall is not reported repeatedly. Notifications and actual task
continuation remain the coordinator's job, based on structured worker evidence.

The **Super Agent** entry stays fixed below the sidebar header, independently of the
worker list's sorting, scrolling, and settled sections. It opens the same coordinator
conversation, without a duplicate ordinary thread row.

On the coordinator, **Toggle right panel** first closes the visible pull request, file,
or other workspace view. These views temporarily replace goals and decisions; closing
them restores the goal panel. With no workspace view open, the toggle opens or closes
goals and decisions. Wide
windows remember the panel's visibility; closing and reopening it preserves the current
search and unsent decision answer. Narrow windows use a dismissible sheet. Its close
button and review button remain separate from the underlying chat toolbar.

## Goals, decisions, and memory

The panel supports search, pages of ten records, adding, editing, deleting, and showing
completed items. Set a goal to `done` in its editor; completed and answered decisions
are hidden by default. Deleting a goal removes its tracking record, not its worker,
workspace, or conversation history. Use T3's native thread controls to stop or archive
work. Restore an archived coordinator with T3's archive controls before reopening it.

Decision records have a stable `dedupeKey` and optional `goalId`. Updating evidence for
the same issue changes its existing card. Agent writes cannot invent or overwrite a
human answer, and cannot delete records. These tools are restricted to the coordinator
conversation. They do not replace T3's provider/tool approval controls.

**Memory** exposes both the stable summary and detailed collaboration records for user
editing and deletion. State lives under `<stateDir>/super-agent/state.json`. The dedicated
workspace contains generated `AGENTS.md` and `CLAUDE.md` startup instructions with the
stable summary. Detailed memories are in `COLLABORATION_MEMORY.md` and available on
demand through `super_agent_read`. They are not appended in full to every message.
Edit memory through the UI or manager tools, not the generated files.

`super_agent_read` bounds list results and offers full content by record ID. Updates
use `expectedRevision` to refuse stale writes and `requestId` for safe retries. Saved
answers have a durable outgoing queue; native acceptance is distinct from a model
reply or completion of the worker's task.

## Local and remote sessions

Each T3 backend owns one coordinator and its records. It sees manually created local
threads as well as its delegated workers. For remote work, enable **Linked environments**
in Settings → Labs and authorize the relevant T3 peer link using the existing T3 flow.
The background observer pages through those already-linked environments. An unreachable
peer is a connection observation, not evidence that its work finished. A remote goal
records both `workerEnvironmentId` and `workerThreadId` to avoid ID collisions.

A browser connection to a remote T3 backend uses the same RPC and authorization checks
as a local connection. An old Herdr SSH entry is not a T3 peer link. This feature does
not import Herdr history, take over existing CLI processes, copy credentials, or migrate
existing Forge sessions automatically.

The desktop manager panel can be resized from its left edge and remembers its width;
the chat area keeps a minimum width. Its tabs contain Goals, Decisions and Memory.
Scheduled sessions have their own sidebar entry.
The management panel works in the shared web/Electron UI; narrow web windows use a
slide-out panel. Native iOS/Android can open and converse with the coordinator as an
ordinary T3 thread, but the custom goal/decision/memory panel is not yet implemented
in React Native. Use the web panel for those controls.

The coordinator role is supplied through provider instructions. It is not a sandbox
that technically removes a provider's shell tools. Choose the provider permission mode
appropriate for the work, and judge completion from worker results rather than a
successful dispatch receipt.

## Forge cron sessions

Open **Scheduled sessions** below the pinned Super Agent in the sidebar, from any chat.
Lists combine T3 native scheduled tasks from connected environments, native Forge cron
and tracked VM plans, with a source filter and explicit offline states. T3 tasks use the
native live subscription and pause/resume, run-now and delete commands; editing opens
the existing T3 scheduled-task settings. Other lists remain separate, with search, paging and expandable details. Native
schedules expose pause/resume and explicit retirement; VM plans offer a read-only
Forge Agent check with delivery receipts and its actual reply. Closing the panel
leaves the current conversation and remote work running.

On the manager's host, sign in with `forgectl`. The coordinator uses that host's existing
`~/.config/forge/config.yaml` (or `$XDG_CONFIG_HOME/forge/config.yaml`); it does not copy
API keys into chat or the manager workspace. VM-local crontab/systemd plans are
tracked separately under `<stateDir>/super-agent/forge-legacy-schedules.json`; their
metadata does not create a native Forge schedule. Ask the existing Forge Agent to verify
or manage those plans through `delegateLegacy`, then inspect `agentReceipt` and
`agentConversation` until the actual result is available. Ask it to list Forge cron sessions, inspect
scheduled outcomes, preview a schedule, create one on a named VM, or pause/resume it.
The tools return the configured origin and account so a wrong account is visible.

`forge_cron_read` takes `query` with `view` set to `list`, `detail`, `wakeups`, `results`,
`environments`, `legacy`, `agentConversation`, `agentReceipt` or `preview`. Lists support bounded search and cursors. `forge_cron_manage`
takes `change` with `operation` set to `create`, `configure`, `pause`, `resume`, `retire`,
`trackLegacy`, `untrackLegacy` or `delegateLegacy`. Tracking and untracking edit only
the inventory, never the remote schedule.
Edits require the last-read schedule revision. Creation starts its initial task immediately
and then saves the recurring follow-up; keep its request ID when inspecting an uncertain
result. Completed stages are reported separately if a later step fails.

Pausing stops future scheduled inputs, leaving current work running. Retiring pauses,
closes that session and archives it while preserving history; it does not delete its VM.
The tools are restricted to the coordinator. Goals can link a native cron through
`forgeSessionId`; these IDs are independent of T3 thread IDs and peer environment IDs.
Background inspections include cron wakeup/outcome changes and stay silent for unchanged
evidence. No existing schedule is rewritten merely by enabling this integration.

## Development verification

Use an isolated T3 home. Never run tests against an active user's data.

```sh
vp test run apps/server/src/superAgent apps/server/src/mcp/toolkits/superAgent
vp run check:changed
```

Behavior checks cover deduplication, human-answer preservation, bounded reads,
request replay, stale writes, persistence and failed delivery, manager-only tool access,
and quiet repeated observations. Verify the full UI flow with a real backend: create
memory, create a decision through the model's tools, answer it, verify its receipt in the
same conversation, reload, and check both wide and narrow layouts.

## Goal inspection and quiet reporting

Every unfinished goal (including blocked/pending goals, external rollouts and goals without
reachable workers) is included in bounded background batches of at most ten goal references.
The next batch continues after the manager becomes idle. Its durable queue survives restart;
references are a coverage aid, not proof that a model has inspected the evidence. The manager
reads each exact goal and follows its worker or an external evidence check to the real result.

A chosen inspection deadline wakes the manager even when no worker changed. Scheduling consumes
that deadline once; unfinished goals retain a 30-minute fallback unless the manager picks another
interval. This is inspection, not a recurring report: unchanged evidence stays silent. An agent's
null plan cannot abandon unfinished goals or override an explicit user pause. The panel's Pause
background reviews control pauses both timed and worker-change inspection; Resume restores it.

## Evidence-backed goal checks

Delivery alone never completes a goal inspection. Background batches stay in flight until
`super_agent_update` operation `verify` accepts evidence for every listed goal. Unverified
batches retry with backoff; missing evidence remains visibly unverified, not successful.

Read the worker or an authoritative source using a real tool, then pass `goalId`, `outcome`,
`summary`, an exact `evidenceQuote` from that tool result, `afterMinutes` and `report`.
The server binds evidence to a completed tool item in the current manager run. Manager
records, dispatch acknowledgements, stale runs and fabricated quotations cannot attest a
check. A goal card shows when it was checked, its evidence and the next inspection time.
Only verification can mark an agent's goal completed; editing a record cannot forge checks.

Blocked goals can carry `blocker: {kind, condition, owner, continuation}`. Human decisions
remain human gates. Verifying an external condition as `ready` durably queues the saved
continuation to the same worker, using a stable native request identity. Acceptance of that
message is separate from finishing the task; an unavailable worker is not replaced.

Use `report: null` for unchanged evidence and routine progress. A new verified milestone,
completion, failure or pending human decision can request a report; repeated evidence is
deduplicated. New background turns without accepted reports stay out of chat and completion
notifications. Explicit user conversations, historical substantive reports and run errors
remain accessible; the original transcript is never rewritten.
