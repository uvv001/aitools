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
you restore the document.

Texts are clean and strict: a finding says what is wrong, where, and what to
do — nothing more. Timestamps read `yyyy-mm-dd hh:mm` from the clock, e.g.
`2026-08-18 16:04`.

## Structure

Four parts, in this order: the `# Review — <target>` title, `## Intro`,
`## Dashboard`, `## Findings`. Each appears once, in that order, and nothing
follows the findings — a title missing or written another way, a section
repeated, misplaced, or added below the findings breaks the contract and
stops the run. Scaffold them with the script next to this file —
[`scaffold-report.ts`](scaffold-report.ts) — instead of writing the document
freehand:

```
node <skill-dir>/scaffold-report.ts <report.md> [<target>]
```

It writes the skeleton — the intro's entries as placeholders, the two lower
sections empty — creates the folder on the way, and refuses to touch a file
that already exists or to write a blank `<target>`, which would title the
document in a way the dashboard script rejects. The structure is a contract:
[`update-dashboard.ts`](update-dashboard.ts) reads findings only from
`## Findings`, where every `###` heading is one, and stops with a message
naming what breaks it rather than rewrite the document. A finding header
outside that section breaks it too — right shape, wrong place — and a
heading inside it the script cannot read is no less a break: a finding the
dashboard drops is a finding the reader never sees.

## Intro

Top of the document, ahead of the dashboard:

- **Reviewed** — per round, the pinned revision and the base it is read
  against, with a dirty-tree note where one applies.
- **Rules** — each instruction file paired with the paths its scope covers,
  plus the user's explicit review questions.
- **Commits** — one line per commit the review made: SHA, timestamp, what it
  carried.
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

The links are GitHub heading slugs: lower-cased, every character outside
`[a-z0-9 _-]` dropped, spaces turned into hyphens — the stripped markers are
what leave the leading hyphens. Run the script after every write to the
findings; edit the section by hand and the next run overwrites it. A broken
structure — a title missing, repeated, or not reading `# Review — <target>`,
a section missing, repeated, out of order, or added after the findings, a
finding header outside `## Findings`, a `###` heading inside them that does
not parse as one, a state or severity marker outside the scales — stops the
run with exit code 1, the offender named with its line and the document
untouched. Nothing else belongs in the section: state history lives in the
findings' own Updates.

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
[SKILL.md](SKILL.md) defines. A state or a severity outside these markers
stops the run with its line named. Severity changes keep the ID and are
logged under Updates.

### Findings raised outside the validation pass

Two kinds arrive after the pass: the ones the user brings in directly, and
the ones a question during triage surfaces. Both take the next free IDs
alongside the agent's own, carrying the same evidence and state — a later
arrival joins the round just completed, the highest the report records, and
carries its `Round <n>:` entry like every other finding. Arriving late opens
no round. Where the user supplies them as text or screenshots, transcribe the
substance.

### Rounds

A round leaves its trace in the findings themselves: every finding carries a
`Round <n>:` Updates entry for that round, whether the round moved it or not.
That record is the only one the format keeps — the dashboard holds no round
history, so a round is read off the findings it touched.
