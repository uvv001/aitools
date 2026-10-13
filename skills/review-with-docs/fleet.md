# Fleet

Reached once the changeset outgrows a handful of files or a few hundred
changed lines and validation dispatches a fleet: the agents and their briefs,
the files they write, and the index the orchestrator holds.

## Briefs

Dispatch one agent per rule, each scoped to the paths that rule covers, plus
two agents no instruction file covers — one for purpose fit, one for the
ecosystem's best practices. A narrow, single-rule brief is what keeps an
agent's findings checkable.

Every brief carries the rule verbatim, the paths in its scope, the pinned
revision, the Evidence section and the Validation severity scale of
[SKILL.md](SKILL.md), and its output: one file per finding — the description
exactly as `finding add` takes it — and a **coverage file** naming the rule,
the paths checked, and the outcome, `no findings` included. The orchestrator
alone runs commands that change the review, so the agent writes files only
and replies with one line per finding — file, severity, title, anchor — or
`no findings`.

## Later rounds

From round 2 on, each brief also lists the findings the review carries — id,
state, title, and the file or report entry holding its description — and
asks for what none of them covers, so an agent hands back only what is new.
One more agent, `recheck`, re-checks every finding in the round's scope and
replies one line per finding — finding, outcome (`fixed`, `holds`, `partial`,
`regressed` or `defective`), one phrase of evidence — plus a finding file for
each new defect it meets, a defective fix included. The orchestrator turns
each line into `finding update --round <n>`, or `set-state` where the state
moves, `fixed` per the States paragraph of [SKILL.md](SKILL.md).

## Files

The files persist beside the report, in the round's folder —
`<report-stem>/round-<n>/<rule>.md` for the coverage file and
`<report-stem>/round-<n>/<rule>/<slug>.md` for each finding — where
`<report-stem>` is the report's file name without `.md` and `<rule>` a short
slug of the rule — `purpose-fit` and `best-practices` for the two agents no
rule covers, `recheck` for the re-check of a later round — e.g.
`2026-09-16_pr157_review/round-1/agents-self-sufficiency.md`; create the
folders as needed. They are committed with the report and hold the text as
raised; the database holds its current version.

## Hold the index, not the findings

The orchestrator's context holds the index — which agent produced which
findings — and the briefs carry the pairing of instruction files and paths
from step 2 of [SKILL.md](SKILL.md). `finding add` reads the files, so the
orchestrator passes paths.
