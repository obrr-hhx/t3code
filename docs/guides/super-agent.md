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
**Resume background reviews** control stalled-goal checks. Worker state changes still
wake the coordinator so a new result or question is not missed. The coordinator can
choose its next check time through `super_agent_update`, including no timed check.
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

On the coordinator, **Toggle right panel** opens or closes goals and decisions. Wide
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

The management panel works in the shared web/Electron UI; narrow web windows use a
slide-out panel. Native iOS/Android can open and converse with the coordinator as an
ordinary T3 thread, but the custom goal/decision/memory panel is not yet implemented
in React Native. Use the web panel for those controls.

The coordinator role is supplied through provider instructions. It is not a sandbox
that technically removes a provider's shell tools. Choose the provider permission mode
appropriate for the work, and judge completion from worker results rather than a
successful dispatch receipt.

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
