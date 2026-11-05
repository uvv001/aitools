# Fleet

The agents a review dispatches — rule, `purpose-fit`, `best-practices`,
`recheck`, and PR-comment agents — their briefs, the files they write, and
the index the orchestrator holds.

## Briefs

Dispatch one agent per rule, each scoped to the paths that rule covers, plus
two agents no instruction file covers — one for purpose fit, one for the
ecosystem's best practices. A narrow, single-rule brief is what keeps an
agent's findings checkable. Pass an explicit `model` on each dispatch,
selecting from the latest-generation models in the dispatch tool's schema, in
two tiers: the strongest deep-reasoning models for `purpose-fit`,
`best-practices`, `recheck`, and semantic or architectural rules; fast,
precise models for mechanical rules and for the PR-comment agents of
[pull-request.md](pull-request.md). The **tier bound**: in each dispatch,
every tier with two or more agents draws on at least two model families
where the schema offers them. Where the orchestrator wrote the fixes,
`recheck` runs on a family other than the orchestrator's.

The **shared brief** — every brief carries it — is the pinned revision, its
base (or none) and the dirty-tree remark, and the Evidence section and the
Validation rule-collision and severity rules of [SKILL.md](SKILL.md). A rule,
`purpose-fit`, or `best-practices` brief also carries the rule verbatim (where
one applies), the paths in its scope, the changeset's purpose as its author
states it, and its output: one file per finding — the description exactly as
`finding add` takes it — and a **coverage file** naming the rule, the paths
checked, the assumptions it set aside with the reason, and the outcome,
`no findings` included; it replies with one line per finding — file, severity,
title, anchor, and ❓ for an unverified one — or `no findings`.

The **read-only contract**: the orchestrator alone runs commands that change
the review, so every dispatched agent writes files only (its own, in the
round's folder) and leaves the working tree, the index, and HEAD as they
stand. It reads the code with `git show <rev>:<path>` and
`git diff <base> <rev>`; for a dirty tree or a target with no base it reads
the files themselves, untracked ones included, and takes a dirty tree's
changes from `git diff <base>`.

## Later rounds

From round 2 on, each brief also lists the findings the review carries — id,
state, title, and the report entry holding its description — and
asks for what none of them covers, so an agent hands back only what is new; a
concern a closed finding (❌ 📌 🔀) covers comes back only with better
evidence, in a finding that names it.
One more agent, `recheck`, re-checks every finding step 7 of
[SKILL.md](SKILL.md) puts in the round's scope. Its coverage file holds one
line per finding — finding, outcome (`fixed`, `holds`, `partial`, `regressed`
or `defective`), one phrase of evidence — and it writes a finding file for
each new defect it meets, a defective fix included, and for each closed
finding whose concern returns, naming it. It replies with those lines, plus
the reply line of a rule brief for each new finding file. The orchestrator
turns each re-check line into `finding update --round <n>`, or `set-state`
where the state moves, `fixed` per the States paragraph of
[SKILL.md](SKILL.md).

## Files

The files persist beside the report, in the round's folder —
`<report-stem>/round-<n>/<rule>.md` for the coverage file and
`<report-stem>/round-<n>/<rule>/<slug>.md` for each finding — where
`<report-stem>` is the report's path without `.md` and `<rule>` a short
slug of the rule — `purpose-fit` and `best-practices` for the two agents no
rule covers, `recheck` for the re-check of a later round — e.g.
`<review-folder>/2026-09-16_pr157_review/round-1/agents-self-sufficiency.md`.
The PR-comment agents of [pull-request.md](pull-request.md) write no coverage
file: each writes `<report-stem>/round-<n>/pr-comments/<ref>.md` per new
finding. Create the folders as needed. They hold the text as raised; the
database holds its current version.

## Hold the index, not the findings

The orchestrator's context holds the index — which agent, on which model,
produced which findings — and the briefs carry the pairing of instruction
files and paths from step 2 of [SKILL.md](SKILL.md). `finding add` reads the
files, so the orchestrator passes paths.

Findings two agents raised on the same anchor merge into one: record the
description whose evidence is stronger, and where the other adds occurrences,
write the merged text to a file in the round's folder, beside the files it
merges, and pass that path to `finding add`.
