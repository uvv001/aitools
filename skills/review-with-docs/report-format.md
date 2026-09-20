# Report format

The report is a markdown document in the reviewed repository, in a folder git
tracks — `docs/` at the root unless the user names another location; create
the folder when it is missing. The report is a deliverable, not scratch: it
never goes to an ignored path. Name it `yyyy-mm-dd_<name>_review.md` from the
clock, where `<name>` derives from the review context — PR number, PR author,
feature name — e.g. `2026-09-16_pr157-tenant-registry_review.md`. An explicit
user-supplied name takes precedence. The name is fixed once chosen: every
later round appends to this same file.

Commit it to the current branch after the initial write, after each triage
batch, after each round, and at the close — the report and the artifacts the
review produced beside it, nothing else. Record each commit in the intro: a
reviewed branch is often rebased or force-pushed, and the SHAs are what let
you restore the document. The record trails by one: a SHA exists only once
its commit does, so each commit is written into the intro by the next one to
touch the report — the next triage batch, round, or close. When no later
commit comes, the list ends one short; that is the rule holding, not a gap.

Texts are clean and strict: a finding says what is wrong, where, and what to
do — nothing more. Timestamps read `yyyy-mm-dd hh:mm` from the clock, e.g.
`2026-08-18 16:04`.

## Structure

Four parts, in this order: the `# Review — <target>` title, `## Intro`,
`## Dashboard`, `## Findings`. Each appears once, in that order, and nothing
follows the findings. Scaffold them with the script next to this file —
[`scaffold-report.ts`](scaffold-report.ts) — instead of writing the document
freehand:

```
node <skill-dir>/scaffold-report.ts <report.md> [<target>]
```

It writes the skeleton — **Reviewed** and **Rules** as placeholders for the
first round to fill, **Commits** and **Status** finished, and the two lower
sections empty — creates the folder on the way, and refuses to touch a file
that already exists or to write a blank `<target>`, which would title the
document in a way the dashboard script rejects.

The structure is a contract, and [`update-dashboard.ts`](update-dashboard.ts)
enforces it. Fenced code blocks sit outside it: nothing inside a fence is
read as a heading or a finding, so quoted examples are always fenced — an
unfenced finding-shaped line is a finding, and validated as one. Each of
these stops the run with exit code 1 and leaves the document untouched,
naming the offending line where there is one and the expectation where the
offender is an absence:

- A fence opens and never closes: the rest of the document would read as
  quoted text, and its findings would vanish.
- The title is missing, repeated, sits below `## Intro`, or reads anything
  but `# Review — <target>`.
- A section is missing, repeated, out of order, added after the findings, or
  is not one of the three.
- A finding header stands outside `## Findings` — right shape, wrong place.
- A `###` heading inside `## Findings` does not parse as a finding header: a
  finding the dashboard drops is a finding the reader never sees.
- A state or severity marker falls outside the scales below.
- Two findings carry the same ID.
- An ID reads anything but `F<n>`, or a lower one follows a higher: the
  findings rise down the section.
- The intro lacks one of its four entries — **Reviewed**, **Rules**,
  **Commits**, **Status** — written as a bold label, on its own or opening a
  bullet.
- A finding lacks `#### Description` or `#### Updates`.

This list is the contract; nowhere else restates it.

## Intro

Top of the document, ahead of the dashboard:

- **Reviewed** — per round, the pinned revision and the base it is read
  against, with a dirty-tree note where one applies. The base is written
  `` base `<revision>` `` where one exists and `base none — reviewed as it
  stands` where there is none, so an absent base never looks like a
  forgotten one.
- **Rules** — each instruction file paired with the paths its scope covers,
  plus the user's explicit review questions. Where no instruction file covers
  the changed paths and the user asked nothing extra, the entry carries one
  line in their place — `- none apply — no instruction file covers the
  changed paths, and no review questions were asked` — so an empty rule set
  never reads as an unfinished step.
- **Commits** — one line per commit the review made: SHA, timestamp, what it
  carried. The newest is written by the commit after it, so the list trails
  the branch by one; before the first is recorded the entry carries one line
  in their place — `- none recorded yet, the record trails by one` — the line
  [`scaffold-report.ts`](scaffold-report.ts) writes into a fresh report.
- **Status** — `active` while the review runs; at the close, `closed
  yyyy-mm-dd hh:mm at <revision>`.

## Dashboard

Below the intro. Generated, never hand-counted, by the script next to this
file — [`update-dashboard.ts`](update-dashboard.ts), which Node 24 or newer
runs directly, without a build step:

```
node <skill-dir>/update-dashboard.ts <report.md>
```

It reads the finding headers of `## Findings` and rewrites everything between
`## Dashboard` and that heading as one section per state that carries
findings — marker, count, label — each listing its findings as numbered
links:

```
### 🔧 20 fixed

  1. [F1](#--f1--re-review-records-a-re-check-entry-but-never-moves-a-marker)
```

The section opens with `<!-- generated by update-dashboard.ts — do not edit
by hand -->`, the marker that says the lines under it are derived. A report
with no findings carries one line in their place:
`**No findings** — the review raised none.`

The links are GitHub heading slugs: lower-cased, every character outside
`[a-z0-9 _-]` dropped, spaces turned into hyphens — the stripped markers are
what leave the leading hyphens. Run the script after every write to the
findings; edit the section by hand and the next run overwrites it. Any break
of the [structure contract](#structure) stops it before it writes. Nothing
else belongs in the section: state history lives in the findings' own
Updates.

## Findings

Flat: one header per finding, all of them in a single section, in ID order,
first round to last. No summary table and no resolved section — the markdown
outline of the headers is the index, and a finding's history stays with the
finding.

The header carries state, severity, ID, and title, and is the single source
of truth for state and severity:

```
### ✅ 🔴 F4 — Icon-only settings button has no accessible name
```

Under it, two subsections, each a `####` heading so a renderer folds them
with the finding:

- **Description** — short explanation, verbatim snippet, suggested fix. When
  conversation changes the finding, this description always holds the latest
  version.
- **Updates** — one entry per question, verdict, revision check, or round,
  oldest first: `- yyyy-mm-dd hh:mm — <what changed or was confirmed>`. A
  change of state is written `⏳ → 🔧` inside the entry, with the reason; an
  entry belonging to a round opens with `Round <n>:`.

### IDs and states

IDs run in one sequence across every round — `F1`, `F2`, …; a new round
continues from the next free number. An ID is never reused and never
renamed.

| Marker | State |
|---|---|
| ⏳ | Awaiting triage — raised, no verdict yet |
| ❓ | Unverified — evidence attempted and unsettled; the user's call |
| ✅ | Approved — the user agreed it is a finding |
| 🔧 | Fixed — the changeset now addresses it; the entry names the revision |
| ❌ | Discarded — not a finding, rationale in Updates |
| 📌 | Deferred — valid, consciously left as-is |
| 🔀 | Improvement — valid, routed outside this changeset |

Any state can follow any other: a fix regresses, a deferred finding gets
addressed, a discarded concern returns with better evidence. There is no
transition table to satisfy — the rule is that every change of state, by the
user or by a round's re-check, is written into Updates with its reason, so an
odd move is visible in the finding's own history.

Severity is one of 🔴 high, 🟡 medium, ⚪ low — the scale
[SKILL.md](SKILL.md) defines. Severity changes keep the ID and are logged
under Updates.

### Findings raised outside the validation pass

Two kinds arrive after the pass: the ones the user brings in directly, and
the ones a question during triage surfaces. Both take the next free IDs
alongside the agent's own, carrying the same evidence and state — a later
arrival joins the round just completed, the highest the report records, and
carries its `Round <n>:` entry like every other finding. Arriving late opens
no round. Where the user supplies them as text or screenshots, transcribe the
substance.

### Rounds

A round leaves two traces, with distinct jobs. The intro's **Reviewed** entry
pins what the round read — its revision and its base. Every finding carries a
`Round <n>:` Updates entry for that round, whether the round moved it or not,
and that is where the round's effects live. The dashboard keeps no round
history, so a round is read off the intro and the findings it touched.
