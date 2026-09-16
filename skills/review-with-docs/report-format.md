# Report format

The report is a markdown document stored in the `docs` folder at the root of
the reviewed repository and tracked in git, so branch updates and rewrites
cannot lose it. Name it `yyyy-mm-dd_hhmm_<name>_review.md` from the current
clock, where `<name>` derives from the review context — PR number, PR
author, feature name — e.g. `2026-09-16_1105_pr157-tenant-registry_review.md`.
An explicit user-supplied name takes precedence. Texts are clean and strict:
a finding says what is wrong, where, and what to do — nothing more.

## Dashboard

Top of the document. Two separate counts:

- **Fix progress** — what the PR author has addressed across revisions.
- **Triage state** — the user's verdicts over all findings.

Never merge the two: author's work and reviewer's decisions move on
different clocks, and a combined number misreads both.

## Summary table

Two columns: `ID` and `Description`. The Description packs the rest:

```
Severity: 🔴 High
File: path/to/file.ts:42-58
One-line statement of the problem.
```

## Findings

One finding per header, state first so a markdown outline reads as a triage
board:

```
### ✅ 🔴 F4 — Icon-only settings button has no accessible name
```

Under each finding, foldable subheaders:

- **Description** — short explanation, verbatim snippet, suggested fix.
  When conversation changes the finding, this top description always holds
  the latest version.
- **Status** — current triage state and severity.
- **Updates** — one dated entry per question, verdict, or revision check,
  timestamped from the current clock; each entry says what changed or was
  confirmed.

### IDs and states

Round 1 IDs are `F1`, `F2`, …; re-review round *n* uses `R<n>-1`, `R<n>-2`,
…. An ID never moves or is reused.

| Marker | State |
|---|---|
| ⏳ | Awaiting triage |
| ✅ | Approved (published to PR) |
| ❌ | Discarded — moved to the resolved section with the disposition rationale |
| 📌 | Deferred — valid, consciously left as-is |
| 🔀 | Improvement — valid but routed outside this PR |

Severity icons: 🔴 high, 🟡 medium, ⚪ low. Severity changes keep the ID and
are logged under Updates.

## Rounds

Each re-review appends a round section (`## Round 2 addendum — review of
<sha>`) reporting both persisting findings (re-checked against the new
revision) and new findings. Prior rounds stay intact: the document is the
history of the whole review/feedback/fix loop, not its latest snapshot.

## Resolved and discarded

Discarded and fixed findings move here, header, evidence, and disposition
included. Deleting a finding erases a decision; moving it preserves one.
