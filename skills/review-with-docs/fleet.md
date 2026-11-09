# Fleet

The agents a review dispatches — rule, `purpose-fit`, `best-practices`,
`recheck`, deduplication, and PR-comment agents — their briefs, the files they
write, and the index the orchestrator holds.

## Briefs

Dispatch one agent per rule, each scoped to the paths that rule covers, plus
two agents no instruction file covers — one for purpose fit, one for the
ecosystem's best practices. A narrow, single-rule brief is what keeps an
agent's findings checkable. Pass an explicit `model` on each dispatch,
selecting from the latest-generation models in the dispatch tool's schema, in
two tiers: the strongest deep-reasoning models for `purpose-fit`,
`best-practices`, `recheck`, deduplication, and semantic or architectural
rules; fast, precise models for mechanical rules and for the PR-comment agents
of [pull-request.md](pull-request.md). The **tier bound**: in each dispatch,
every tier with two or more agents draws on at least two model families
where the schema offers them. Where the orchestrator wrote the fixes,
`recheck` runs on a family other than the orchestrator's.

The **shared brief** — every brief carries it — is the pinned revision, its
base (or none) and the dirty-tree remark, the Evidence section and the
Validation rule-collision and severity rules of [SKILL.md](SKILL.md), and the
read-only contract below. A rule, `purpose-fit`, or `best-practices` brief
also carries the rule verbatim (where one applies), the paths in its scope,
the changeset's purpose as its author states it, and its output: one file per
finding — the description exactly as `finding add` takes it — and a **coverage
file** naming the rule, the paths checked, the assumptions it set aside with
the reason, and the outcome, `no findings` included; it replies with one line
per finding — file, severity, title, anchor, and ❓ for an unverified one — or
`no findings`.

The **read-only contract**: the orchestrator alone runs commands that change
the review, so every dispatched agent writes files only (its own, in the
round's folder), does not read or parse the `.md` report during an active
review (the `.md` report is for user convenience and post-session
discoverability only), and leaves the working tree, the index, and HEAD as
they stand. It reads the code with `git show <rev>:<path>` and
`git diff <base> <rev>`; for a dirty tree or a target with no base it reads
the files themselves, untracked ones included, and takes a dirty tree's
changes from `git diff <base>`.

## Later rounds

From round 2 on, execution separates into two ordered phases:

1. **Verification phase (`recheck`).** First, verify every open finding
   (⏳ ❓ ✅), every 🔧 fixed finding, and any closed finding (❌ 📌 🔀) whose
   code changed against the full changeset and codebase (step 7 of
   [SKILL.md](SKILL.md)). Up to 15 findings in re-check scope use one `recheck`
   agent; past 15 findings, shard verification across parallel `recheck-1`,
   `recheck-2`, … agents (~15–20 findings per agent, each with full codebase
   access and its own `<report-stem>/round-<n>/recheck-<i>.md` coverage file).
   Each `recheck` brief carries the shared brief, the findings in its shard
   (id, state, title, and description from `finding list` / `finding show`),
   step 7 from "Every round reads the **full changeset**" to "whose state
   stands until the user rules" verbatim, and the States paragraph from
   "verifies it the way the finding was verified" to "confirms it" of
   [SKILL.md](SKILL.md). Its coverage file holds one line per finding —
   finding, outcome (`fixed`, `holds`, `partial`, `regressed` or `defective`),
   and the evidence at the new revision — and it writes a finding file for each
   new defect it meets, a defective fix included, and for each closed finding
   whose concern returns, naming it. It replies with those lines, plus the
   reply line of a rule brief for each new finding file. Record all outcomes
   (`finding update` / `finding set-state` and any new finding from a defective
   fix or returning closed concern) in the database before starting discovery.
2. **Discovery phase.** Only after the verification phase is recorded in the
   database, dispatch the round's discovery fleet (`purpose-fit`,
   `best-practices`, and rule agents), passing the updated finding list from
   `finding list` / `finding show` — id, post-verification state, title, and
   description (or, past 30 findings, instructing agents to read `finding list`
   and `finding show` with `--db <file.sqlite>`) — so discovery agents see the
   post-verification states and descriptions. Each brief asks for what none of
   them covers, so an agent hands back only what is new; a concern a closed
   finding (❌ 📌 🔀) covers comes back only with better evidence, in a finding
   that names it.

## Files

The files persist beside the report, in the round's folder —
`<report-stem>/round-<n>/<rule>.md` for the coverage file and
`<report-stem>/round-<n>/<rule>/<slug>.md` for each finding — where
`<report-stem>` is the report's path without `.md` and `<rule>` a short
slug of the rule — `purpose-fit` and `best-practices` for the two agents no
rule covers, `recheck` (or `recheck-1`, `recheck-2`, … when sharded) for the
re-check of a later round — e.g.
`<review-folder>/2026-09-16_pr157_review/round-1/agents-self-sufficiency.md`.
Merged candidate findings live at `<report-stem>/round-<n>/merged/<slug>.md`.
The PR-comment agents of [pull-request.md](pull-request.md) write no coverage
file: each writes `<report-stem>/round-<n>/pr-comments/<ref>.md` per new
finding. Create the folders as needed. They hold the text as raised; the
database holds its current version.

## Hold the index, not the findings

The orchestrator's context holds the index — which agent, on which model,
produced which findings — and the briefs carry the pairing of instruction
files and paths from step 2 of [SKILL.md](SKILL.md). `finding add` reads the
files, so the orchestrator passes paths.

## Merging

Findings that point at the same anchor or the same underlying root cause across
agents merge into one: record the description whose evidence is stronger, fold
in any additional occurrences or anchors from the others, write the merged text
to `<report-stem>/round-<n>/merged/<slug>.md`, and pass that path to
`finding add`.

When a round surfaces more than 10 candidate findings or the review already
carries more than 30 findings in `finding list`, dispatch a deduplication agent
(or a sharded deduplication fleet when `candidates × existing findings` is
large, ~10–15 candidates per agent followed by a cross-shard merge) with the
shared brief, access to the candidate finding files, `finding list` /
`finding show` (`--db <file.sqlite>`), and the codebase to merge
overlapping/same-cause candidates into
`<report-stem>/round-<n>/merged/<slug>.md` and filter out candidates already
covered by existing findings before the orchestrator runs `finding add`.
