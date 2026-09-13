---
name: progress-tracking
description: Progress tracking at the start of every primary session, before handling its first request, and on resumption. Initialize a record even for brief work.
---

# Progress tracking

Initialize tracking before task work in every primary session, including brief
requests. Prefer an extra working record to an unrecorded session. Continue across
later turns until the user stops tracking or changes its scope.

Working notes belong in ignored `.ai` storage; requested code and reusable
definitions remain in their normal versioned locations. Tracking follows the
task's permissions and does not authorize unrelated changes.

**Setup:** When installing automatic startup or diagnosing a missing startup
invocation, read [activation.md](activation.md). A discoverable description alone
is not a lifecycle trigger.

**Recovery:** For interrupted work, unclear record ownership, late history, parallel
work, logging failures, sensitive output, or requested archival, read
[edge-cases.md](edge-cases.md) before handling that case.

## 1. Select private storage and a record

Use the user's chosen workspace ahead of the shell's startup directory.
Otherwise use the active project root, or the current directory outside a project.
Store progress and auxiliary working artifacts under `.ai` at that root, each
named to end in `_progress.md`.
In Git repositories, confirm the record is ignored and untracked; follow
[Git storage](edge-cases.md#git-storage) when exclusion or migration is needed.

Reuse a record only when it is confirmed to belong to this session and workstream.
A new independent session or fork gets its own record, even for the same topic.
Coordinated subagents report to their parent rather than create competing records.

For a new record or a naming decision, follow [naming.md](naming.md). Read an
existing owned record before updating it. Preserve its notes, decisions, and history.
Carry the selected absolute path in the session context and handoffs.

**Ready when:** An ignored, untracked destination is selected without taking over
another record; ownership and any provisional naming state are clear.

## 2. Open the record before substantial work

Keep a short summary of the goal, current state, and next action. Add findings or
decisions only when useful. Link proposals and deliverables instead of reproducing
their contents.

A `## Contributors` section immediately before the log lists one line per
contributor, `<model> (<harness>, <role>): <contribution phrase>` — orchestrator
first, each subagent added on its first report. Update a line only when that
contributor's work materially expands.

- kimi-k3 (copilot, orchestrator): record keeping, skill edits
- gpt-5.6-luna (copilot, explore agent): auth flow trace

The final section is always `## Activity log`, with exactly two columns:
`Date/time` and `Description`. Each description is a short, single-line note
opening with `[model]`, the harness-reported identity of the model responsible
for the logged work (`unknown` when unavailable); a subagent's reported work
carries the subagent's model. Escape literal pipes so the table keeps two
columns.

Read the clock for new entries. New logs use full ISO 8601 timestamps with a UTC
offset; existing logs retain their declared time convention. Record the actual
logging start, resumption, or task transition.

Notify the user of the chosen path. If no task has been supplied, initialize an
awaiting-task summary and then wait for direction. Naming uncertainty must not
silently skip initialization; the naming guide defines the provisional path.

**Ready when:** The file is saved and readable, its current summary is accurate,
the contributor list is open with the orchestrator, the user knows its location,
and tracking is visible before the main work begins.

## 3. Keep the record live

Before a substantial attempt, record what is starting. When a meaningful result,
decision, failure, retry, or wait becomes known, append what happened and the next
action if needed. Include useful artifact links and distinguish observed results
from reports or unverified claims.

Group routine lookups into a work burst; record changes to the approach, task
state, or artifacts. Refresh the summary and relevant notes as understanding
changes. Preserve the activity history; explain corrections in follow-up entries
unless the user requests a rewrite.

**At each work boundary:** Every substantial attempt since the previous checkpoint
has an outcome or an explicit waiting/blocking note, and the summary reflects it.

## 4. Checkpoint and continue

Before pausing, handing off, or responding with a result, save the current state,
pending decisions, and next action. Check that the record follows the layout above,
new timestamps have a known basis, and artifact references resolve or are clearly
marked as planned. Keep `.ai` artifacts out of staging and commits.

On the next turn, read the summary and relevant log tail before continuing.
Use current authorization to choose the next work; treat earlier plans as
historical evidence.

**Checkpoint complete when:** The saved file lets the user see what happened,
what remains open, and which artifact or decision to inspect next.
