# Research mode — extracting rules across past sessions

Reach for this when the extraction target is session *history* rather than the
live session. The shape: inventory → scan → fleet → aggregate. Keep the
propose-then-persist gate from SKILL.md for anything the research later feeds.

## Inventory

Session history lives under `~/.copilot/session-state/<session-id>/`:

- `events.jsonl` — one JSON event per line; user prompts are lines starting
  `{"type":"user.message"` with the raw text at `data.content`. Lines run to
  megabytes; grep narrowly, never read whole files.
- `checkpoints/index.md` — compact storyline; read it first.
- `files/` — session artifacts.

The local session store adds metadata (`sessions` table: cwd, summary, dates)
and a partial FTS5 `search_index`; treat it as a lead generator, not full
coverage. `/chronicle` (a built-in CLI command) is the user's interactive entry
to the same data.

## Scan

Sessions are numerous and huge (hundreds of files, hundreds of MB). First pass
is mechanical, not agentic: script a regex over user.message lines with
extraction vocabulary (extract, distill, preserve, lessons, rules, guides,
skill, subagent, AGENTS.md, copilot-instructions, "for review"), and record each
hit with session id, timestamp, and the full verbatim prompt to a working file.
Expect heavy noise from skill-context wrappers, system reminders, and code
refactors; the verbatim prompts make classification cheap.

## Fleet

Delegate reading to background general-purpose subagents with **disjoint
session scopes** and a strict report contract: verbatim prompts with
timestamps, the assistant's proposal, the user's review decision, the resulting
document and its format, and links (session id, event line, artifact path).
Each agent writes its own `research-part-<scope>.md` into a working folder and
returns only a compact summary. Explore agents are read-only: they cannot write
part files, so their findings must be persisted by the caller.

Keep for the coordinating agent: the scan, the aggregation, and the merge.

## Aggregate

Merge part reports into one durable results document under ignored `.ai`
storage (`yyyy-mm-dd-<topic>-research.md`): the verbatim prompt catalog grouped
by pattern, the observed document formats, the review/persist workflows, and
explicit source links. Working artifacts stay out of git; only the skill or
rules the research feeds are committed.
