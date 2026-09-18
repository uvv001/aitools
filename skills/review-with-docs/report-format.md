# Report format

The report is a markdown document in the reviewed repository — `docs/` at the
root unless the user names another location; create the folder when it is
missing. Name it `yyyy-mm-dd_<name>_review.md` from the clock, where `<name>`
derives from the review context — PR number, PR author, feature name — e.g.
`2026-09-16_pr157-tenant-registry_review.md`. An explicit user-supplied name
takes precedence. The name is fixed once chosen: every later round appends to
this same file.

Commit it to the current branch after the initial write, after each triage
batch, after each round, and at the close — the report and any artifact kept
outside the ignored working folder, nothing else. Record each commit in the
header: a reviewed branch is often rebased or force-pushed, and the SHAs are
what let you restore the document.

Texts are clean and strict: a finding says what is wrong, where, and what to
do — nothing more. Timestamps read `yyyy-mm-dd hh:mm` from the clock, e.g.
`2026-08-18 16:04`.

## Header

Top of the document, ahead of the dashboard:

- **Reviewed** — per round, the pinned revision and the base it is read
  against, with a dirty-tree note where one applies.
- **Rules** — each instruction file paired with the paths its scope covers,
  plus the user's explicit review questions.
- **Commits** — one line per commit the review made: SHA, timestamp, what it
  carried.
- **Closed** — added at the close: the final revision and the date.

## Dashboard

Below the header. Generated, never hand-counted, by the script next to this
file — [`Update-Dashboard.ps1`](Update-Dashboard.ps1):

```
pwsh -File <skill-dir>/Update-Dashboard.ps1 -Path <report.md>
```

It reads the finding headers, tallies state and severity, enumerates the
rounds that moved a finding, and rewrites everything between `## Dashboard`
and the next `##` heading. Run it after every write to the findings; edit the
section by hand and the next run overwrites it.

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
  entry belonging to a round opens with `Round <n>:`. Those two shapes are
  what the dashboard script reads.

### IDs and states

Round 1 IDs are `F1`, `F2`, …; round *n* uses `R<n>-1`, `R<n>-2`, …. An ID is
never reused and never renamed.

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

Severity changes keep the ID and are logged under Updates.

### Findings raised outside the validation pass

Two kinds arrive after the pass: the ones the user brings in directly, and
the ones a question during triage surfaces. Both take IDs in the current
round alongside the agent's own, carrying the same evidence and state — a
later arrival joins the current round rather than opening a new one. Where
the user supplies them as text or screenshots, transcribe the substance.

### Rounds

A round leaves its trace in the findings themselves: every finding carries a
`Round <n>:` Updates entry for that round, whether the round moved it or not.
That record is required. The dashboard's rounds enumeration is derived from
those entries by the script and is optional — it appears when a round moved
something.
