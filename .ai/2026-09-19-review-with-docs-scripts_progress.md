# Review-with-docs scripts — progress

## Summary

**Goal.** Preserve the workstream behind the two TypeScript scripts of the
`review-with-docs` skill — `update-dashboard.ts` and `scaffold-report.ts` —
so a later session can pick up their maturation cold.

**Current state.** Both scripts live in `skills/review-with-docs/`, run
directly by Node 24+ (no build, no dependencies, no tests), and are exercised
only by hand against the live review report and throwaway scratch files. They
enforce the structure contract of `report-format.md` and generate the report's
dashboard. Twenty-nine review rounds (findings F1–F68 in
`.ai/reviews/2026-09-18_review-with-docs_review.md`) drove them from a
PowerShell counter to a validating generator. The last commit is `10417f9`.

**Next action.** None requested — the user has explicitly deferred the
maturation. When it resumes: move the scripts into their own development
folder with a test suite built from the edge-case catalog below, and keep the
skill directory self-sufficient (see *What a mature structure needs*).

## Intent (deferred, recorded on request)

The scripts have outgrown "a helper next to a skill": 276 and 72 lines of
validation logic whose every rule was paid for by a defect found in review.
The user wants them treated as software — their own development folder, real
test coverage, and a release path back into the skill directory — but not
now. This record exists so that work can start from evidence instead of
re-derivation.

## Architecture and rationale

- **Node + TypeScript, run directly.** The first version was
  `Update-Dashboard.ps1` (`2247461`). The user's portability directive
  replaced it: PowerShell is Windows-only, so the rewrite (`b1eb877`) became
  a `.ts` file executed by modern Node's type stripping — `node
  update-dashboard.ts <report.md>`, no build step, no dependencies. The skill
  checks `node --version` and, where Node is missing or older than 24, stops
  and raises it with the user. No silent fallback, ever.
- **Two scripts, one contract.** `scaffold-report.ts` creates the document;
  `update-dashboard.ts` validates and regenerates it. Both serve a single
  enumerated contract that lives in `report-format.md`'s Structure section —
  the creator must never produce a document its sibling rejects (`F37`).
- **The docs are the contract; the scripts serve them.** Standing user
  directive, written into `SKILL.md`'s guardrails (`ee9e002`): where a script
  disagrees with `report-format.md` or `SKILL.md`, the script is what
  changes. Every behaviour the scripts enforce is first stated in the docs.
- **Hard errors over warnings.** The user rejected warn-and-continue twice
  (`F31`, `F35`): "the agent will have no choice other than fix the error." A
  structure break exits non-zero, names the offender with its line, and
  leaves the document untouched — nothing is written until every check has
  passed.
- **Single-sourcing.** Rules stated twice drift (`F41`, `F45`, `F49`). The
  contract is enumerated once in `report-format.md`'s Structure section; the
  Dashboard spec, the states and severity paragraphs, `SKILL.md`'s guardrails
  and the scripts' header comments reference it instead of restating it.
- **Empty states are defined, never improvised** (`F40`, `F46`, `F47`): a
  report with no findings carries `**No findings** — the review raised
  none.`; an unrecorded commit list carries `- none recorded yet, the record
  trails by one`; an absent base reads `base none — reviewed as it stands`.
- **Presence-only enforcement boundary.** The scripts check that mandatory
  elements *exist* — sections, intro entries, finding subsections — never
  what they contain. Deliberate: content is the agent's judgement, structure
  is the machine's. The one exception is the finding header itself, whose
  state marker, severity marker and ID shape/order are fully validated,
  because the dashboard is derived from them.
- **The commit record trails by one** (`F44`). A SHA exists only once its
  commit does, so each commit is recorded in the report's intro by the next
  one to touch the report. A record ending one short is the rule holding, not
  a gap — and `update-dashboard.ts` therefore checks only that the
  `**Commits**` entry exists.
- **The header is the single source of truth for state.** The PowerShell
  version read state transitions out of Updates prose and missed wrapped
  lines (`d7ac5a8`, finding `F25`); the redesign moved state into the finding
  header, where one regex settles it.

## Edge-case catalog — the test-suite specification

Every case below was found by a review round and is currently verified by
hand. Expected behaviour on failure is always the same triple: **exit 1, a
message naming the offender and its line, and the file left byte-identical.**

### `update-dashboard.ts` — invocation

| # | Case | Expected | Commit |
|---|---|---|---|
| 1 | No path argument | `usage: node update-dashboard.ts <report.md>` | `b1eb877` |
| 2 | Path does not exist | `report not found: <path>` | `b1eb877` |

### `update-dashboard.ts` — structure contract

| # | Case | Expected | Commit |
|---|---|---|---|
| 3 | No `# Review — <target>` title | names the expected title | `806d04c` |
| 4 | Title repeated | names every title line | `806d04c` |
| 5 | Title reads anything else (incl. blank target) | names the found title and the expectation | `806d04c` |
| 6 | Title below `## Intro` | names the line | `806d04c` |
| 7 | Unknown `##` section | names it; the report holds Intro, Dashboard, Findings and nothing else | `398c1c4` |
| 8 | Section repeated (e.g. two `## Dashboard`) | names the second line | `398c1c4` |
| 9 | Section missing | names which | `bb6a586` |
| 10 | Sections out of order | names the first out-of-place section with its line, then found vs expected order | `398c1c4`, `dca873a` |
| 11 | Section added after `## Findings` | rejected as unexpected/out-of-order | `398c1c4` |
| 12 | Finding-shaped `###` outside `## Findings` | names the header and its line | `3438c4f` |
| 13 | `###` inside `## Findings` that does not parse | names the line and the expected shape | `806d04c` |
| 14 | Unknown state marker | names the line and the marker | `b1eb877` |
| 15 | Unknown severity marker (outside 🔴🟡⚪) | names the line and the marker | `b2a3e49` |
| 16 | Duplicate finding ID | names the ID and every line it sits on | `bda3832` |
| 17 | ID not shaped `F<n>` | names the line and the shape | `a49aeab` |
| 18 | IDs not ascending | names the line and the predecessor | `a49aeab` |
| 19 | Intro missing one of **Reviewed**, **Rules**, **Commits**, **Status** | names the missing entries | `ae26be8` |
| 20 | Finding missing `#### Description` or `#### Updates` | names the finding, its line, the missing part | `ae26be8` |
| 21 | Fence opened and never closed (EOF reached inside it) | names the line the fence opened on; checked before every other rule, since the parse below it is unreliable | `63401fa` |

### `update-dashboard.ts` — generation

| # | Case | Expected | Commit |
|---|---|---|---|
| 21 | Report with findings | one `### <marker> <count> <label>` section per state present, each listing numbered `[ID](#anchor)` links in ID order | `b1eb877` |
| 22 | Report with no findings | the single line `**No findings** — the review raised none.` | `b1eb877` (documented `a20950e`) |
| 23 | Anchors | GitHub slug: lower-cased, characters outside `[a-z0-9 _-]` dropped, spaces → hyphens; stripped markers leave the leading hyphens | `b1eb877` |
| 24 | Fenced code blocks | lines inside ``` or ~~~ never parse as headers, sections or entries — quoted examples are inert; nesting tracked by marker char and length | `b1eb877` |
| 25 | Hand-edited dashboard | overwritten wholesale between `## Dashboard` and `## Findings` | `b1eb877` |
| 26 | Second run on an unchanged report | byte-identical output (idempotent) | verified every round |
| 27 | Line endings | CRLF vs LF detected from the input and preserved | `b1eb877` |
| 28 | Wrapped Updates entries | must never affect parsing — state lives in the header (the defect that killed the PowerShell reader) | `d7ac5a8` |

### `scaffold-report.ts`

| # | Case | Expected | Commit |
|---|---|---|---|
| 29 | No path argument | usage message, exit 1 | `bb6a586` |
| 30 | Target file exists | refuses, exit 1, existing file untouched | `bb6a586` |
| 31 | Blank or whitespace `<target>` | exit 1 explaining the title `update-dashboard.ts` would reject | `b4378ce` |
| 32 | `<target>` omitted | writes the literal `<target>` placeholder | `b4378ce` |
| 33 | Missing parent folder | created on the way | `bb6a586` |
| 34 | Fresh skeleton | title, `## Intro` with all four entries, empty `## Dashboard`, empty `## Findings` | `bb6a586` |
| 35 | Fresh skeleton, commits entry | carries `- none recorded yet, the record trails by one`, not a `<sha>` placeholder | `ad7ebe7` |
| 36 | Fresh skeleton, base slot | one `<base>` slot, never two (`base base none` was the defect) | `510f7b9` |
| 37 | Round trip | a freshly scaffolded report passes `update-dashboard.ts` with exit 0 | verified every round |

### Cross-cutting invariants

- Validation runs to completion before anything is written: a failing run
  never leaves a half-updated document.
- Check order is unclosed fence → title → sections → misplaced header →
  malformed header → unknown marker → duplicate ID → ID shape → ID order →
  intro entries → finding subsections. Tests that assert a message must pin
  the order.
- The state list (⏳ ❓ ✅ 🔧 ❌ 📌 🔀) and the severity list (🔴 🟡 ⚪) are
  duplicated between `report-format.md` and the script by necessity; a test
  should assert they match.
- `scaffold-report.ts` now writes a clock value — the **Status** entry's
  `active since yyyy-mm-dd hh:mm` — so a test asserting the skeleton
  byte-for-byte must control the clock (inject the `Date`, or match the
  stamp with a pattern).
- The fence exemption cuts both ways: content appended *inside* a fenced
  quote is invisible to every check, so a patching tool that inserts Updates
  entries must locate `#### Updates` fence-aware and must not treat a
  fenced `### ` line as a finding boundary. Round 25 found fifteen lines of
  F39's history sitting inside its quoted dashboard since round 11, with the
  validator reporting exit 0 throughout.

## Current state — files and how to run them

```
skills/review-with-docs/
  SKILL.md             9247 bytes, 147 lines   the 7-step protocol
  report-format.md     9079 bytes, 190 lines   the document contract
  update-dashboard.ts 11235 bytes, 284 lines   validator + dashboard generator
  scaffold-report.ts   2286 bytes,  72 lines   skeleton writer
```

```
node skills/review-with-docs/scaffold-report.ts <report.md> [<target>]
node skills/review-with-docs/update-dashboard.ts <report.md>
```

Verified against Node v24.16.0 on Windows. No `package.json`, no lockfile, no
test runner, no CI. Verification today is a manual loop: run the dashboard
script against the live report (exit 0), run it again and compare hashes
(idempotence), check every anchor resolves against the report's own headings,
then reproduce each new failure case on a scratch file and confirm exit 1 with
the file untouched.

## What a mature structure needs

- A development folder (e.g. `tools/review-with-docs/`) holding the sources,
  `node:test` suites, fixtures for every catalog row, and a typecheck step —
  `tsc --noEmit` — that the runtime type stripping does not provide.
- Fixtures as whole documents: a valid report, and one file per violation.
  Assertions on exit code, on the message naming the offender, and on the
  file's bytes being unchanged.
- A release step that copies the sources into `skills/review-with-docs/`.
  This is the tension to solve first: the repository's `AGENTS.md` requires a
  skill directory to be self-sufficient — it installs alone — so the shipped
  scripts must stay in the skill folder even when their tests do not.
- A regression guard that reads the contract list out of `report-format.md`
  and asserts one test exists per bullet, so a new rule cannot ship untested.

## Open ambiguities (deliberately unenforced)

- The order of `#### Description` and `#### Updates` within a finding.
- Extra `####` subsections inside a finding.
- The *contents* of intro entries — e.g. whether `**Status**` reads `active`
  or `closed …`, or whether **Reviewed** actually pins a revision.
- Whether a `#` heading inside a finding's prose should be a structure error
  (today it counts as a second title and fails).

## Contributors

- kimi-k3 (copilot, orchestrator): triage relay, user directives, this record's brief
- claude-opus-5 (copilot, implementer): script authoring, review rounds, report maintenance

## Activity log

| Date/time | Description |
|---|---|
| 2026-09-18T16:18:00-04:00 | [claude-opus-5] `2247461` added `Update-Dashboard.ps1`, a PowerShell dashboard counter. |
| 2026-09-18T16:24:00-04:00 | [claude-opus-5] `d7ac5a8` taught it to read wrapped Updates entries (F25) — the defect that later moved state into the finding header. |
| 2026-09-19T13:46:00-04:00 | [claude-opus-5] `b1eb877` rewrote it as `update-dashboard.ts` for Node 24 type stripping, per the portability directive; added fenced-code awareness, per-status linked sections, the no-findings line, state-marker validation, CRLF preservation (F20–F24). PowerShell removed. |
| 2026-09-19T18:54:00-04:00 | [claude-opus-5] `bb6a586` added `scaffold-report.ts` and made the structure a contract the dashboard script enforces — missing sections, existing-file refusal, folder creation (F27). |
| 2026-09-19T19:13:00-04:00 | [claude-opus-5] `3438c4f` turned a finding header outside `## Findings` into a hard error (F31) — the user rejected warn-and-drop. |
| 2026-09-19T19:39:00-04:00 | [claude-opus-5] `930b024` renamed the report's `## Header` section to `## Intro` across both scripts and the docs. |
| 2026-09-19T19:40:00-04:00 | [claude-opus-5] `398c1c4` rejected repeated sections and anything after `## Findings` (F32, F33). |
| 2026-09-19T19:48:00-04:00 | [claude-opus-5] `806d04c` stopped on a malformed finding header and added the title rules — presence, uniqueness, shape, position (F35, F36); `d73844f` wrote the title rule into the contract. |
| 2026-09-19T20:25:00-04:00 | [claude-opus-5] `b4378ce` refused a blank scaffold target (F37); `b2a3e49` validated the severity marker beside the state marker (F38). |
| 2026-09-19T20:35:00-04:00 | [claude-opus-5] `bda3832` made a duplicate finding ID a hard error (F39). |
| 2026-09-19T20:36:00-04:00 | [claude-opus-5] `48e2f77` single-sourced the structure contract into one enumeration and pointed the script's header comment at it (F41); `a20950e` documented the empty-dashboard line (F40). |
| 2026-09-19T20:41:00-04:00 | [claude-opus-5] `a49aeab` enforced the ID shape `F<n>` and ascending order (F42). |
| 2026-09-19T20:46:00-04:00 | [claude-opus-5] `ae26be8` extended the contract below the headings: the intro's four entries and each finding's `#### Description` / `#### Updates` (F43). |
| 2026-09-19T21:01:00-04:00 | [claude-opus-5] `ad7ebe7` gave the empty commit record a defined line the scaffold writes (F46). |
| 2026-09-19T21:06:00-04:00 | [claude-opus-5] `0c7c1bb` defined the absent-base form; `6a79bf0` corrected the stale description of the skeleton (F47, F48). |
| 2026-09-19T21:21:00-04:00 | [claude-opus-5] `510f7b9` reduced the base placeholder to one slot; `2085f15` left the absent-base wording in the format alone and had the protocol and the scaffold point at it (F49, F50). |
| 2026-09-19T21:26:00-04:00 | [claude-opus-5] Reconstructed this record from the turn history, `git log --follow -S` on both scripts, and the review report's Updates entries, at the user's request; the scripts' maturation stays deferred. |
| 2026-09-19T21:26:00-04:00 | [claude-opus-5] While reconstructing, found the report's intro recorded commit `d7ac5a87`, a mistyped prefix of `d7ac5a819d7610f226bd404e4fcc0d8825d566ef`, and an earlier note claiming it had been amended away; corrected in the report. |
| 2026-09-20T18:25:00-04:00 | [kimi-k3 → claude-opus-5] Rounds 16–19 (F51–F55) refined the contract's prose only — both base literals written out, the dashboard's generated-by marker documented, the unknown-section break listed, the skeleton description corrected, and the "names the offending line" promise qualified for absences. |
| 2026-09-20T18:25:00-04:00 | [claude-opus-5] `dca873a` applied the docs-are-the-contract directive to an out-of-order section: the script now names the first out-of-place section with its line instead of printing only the sequence (F56). |
| 2026-09-20T18:36:00-04:00 | [claude-opus-5] `ed41e76` moved the fenced-block exemption out of the script's header comment into the contract itself — quoted examples are always fenced, an unfenced finding-shaped line is a finding (F57). |
| 2026-09-20T18:43:00-04:00 | [claude-opus-5] `63401fa` made a fence left open at EOF a hard structure error naming its opening line (F58) — found while probing F57's new rule: an unclosed fence silently hid every finding below it, exit 0 and all. |
| 2026-09-20T18:50:00-04:00 | [claude-opus-5] Round 22 raised F59: **Rules** is the only intro entry without a defined empty form, so a repository with no instruction files leaves the agent improvising or shipping the scaffold's placeholder, which the presence-only check accepts. |
| 2026-09-20T18:53:00-04:00 | [claude-opus-5] `e38c811` defined that empty form — `- none apply — no instruction file covers the changed paths, and no review questions were asked` in the Intro spec, step 2's Ready-when resolving to it, and `scaffold-report.ts` naming **Rules** among the slots the spec fills, as it already did for `<base>` (F59). Scripts unchanged beyond the comment: the presence-only boundary holds. |
| 2026-09-20T19:00:00-04:00 | [claude-opus-5] Round 23 raised F60, a docs-only contradiction: the format's Rounds section calls the findings' `Round <n>:` entries "the only [record] the format keeps", though the intro's **Reviewed** entry records each round's revision and step 6 requires it. |
| 2026-09-20T19:00:00-04:00 | [claude-opus-5] Note for the test suite: the report-patching helper used between rounds (not part of the skill) applied payload blocks in payload order, not document order, and rewrote a stale line index. Whatever tooling replaces it must patch from the bottom of the document up and assert the header it rewrites still carries the expected ID. |
| 2026-09-20T19:05:00-04:00 | [claude-opus-5] `3682d34` reworded the format's Rounds section: a round leaves two traces — the intro's **Reviewed** entry pins what it read, the findings' `Round <n>:` entries hold its effects, the dashboard keeps none (F60). Docs only; no script change. |
| 2026-09-20T19:10:00-04:00 | [claude-opus-5] Round 24 raised F61, a protocol gap rather than a script one: step 6 opens a round on any new change, step 7 ends the review, and nothing defines what a change landing after the close does — the **Status** spec has no reopened form. |
| 2026-09-21T08:58:00-04:00 | [claude-opus-5] `8c7a4e6` defined the way back from a close (F61): step 6 carries the reopen branch — the same report continues, its status returns to `active — reopened yyyy-mm-dd hh:mm, <what landed>`, round and ID sequences carry on, and a genuinely different target goes to the user. Docs only; no script change. |
| 2026-09-21T09:00:00-04:00 | [claude-opus-5] Round 25 found fifteen lines of F39's Updates history (triage plus rounds 9–11) sitting inside the finding's quoted dashboard fence, appended there by the between-rounds patching helper in round 11 and invisible ever since — the fence exemption means `update-dashboard.ts` reported exit 0 the whole time. Repaired the report by hand-asserted script and made the helper fence-aware; recorded as a cross-cutting invariant for the test suite. |
| 2026-09-21T09:00:00-04:00 | [claude-opus-5] Round 25 raised F62 and F63, both fallout of F61's own fix: step 7 still calls the closing commit the entry `the record never carries`, which a reopen falsifies, and the reopened **Status** form claims the close `stays on record` while overwriting its timestamp and revision. Docs-level; the presence-only script boundary is untouched either way. |
| 2026-09-21T09:13:00-04:00 | [claude-opus-5] `bd1f5b8` and `2e62364` settled the reopen's fallout (F62, F63): step 7's Ready-when now states the format's trailing rule at close time — the closing commit trails and is picked up where a reopen brings a later commit — and the reopened **Status** form carries `after the close of yyyy-mm-dd hh:mm at <revision>` instead of overwriting it. Docs only; the presence-only script boundary untouched. |
| 2026-09-21T09:20:00-04:00 | [claude-opus-5] Round 26 raised F64 and F65, both on the same seam: only a *change* reopens a closed review, so a verdict on the ⏳ findings a close deliberately leaves open has no defined status or commit path (and the format commits `after each triage batch`), and a second close overwrites the close the reopened form was made to carry. |
| 2026-09-21T09:26:00-04:00 | [claude-opus-5] `a285f00` and `dc6b8bc` closed the reopen seam (F64, F65): any post-close event that touches the report reopens the review — a change opens a round, a verdict is step 5 and opens none — and the **Status** entry now splits state from history, the label line holding the current state while every state left behind is added under the entry, oldest first, so closes and reopens accumulate. Scripts unchanged; the contract still checks only that the **Status** label is present. |
| 2026-09-21T09:28:00-04:00 | [claude-opus-5] Round 27 raised F66 and F67, both leftovers of that pair: the protocol's closing loop sentence still says `which a later change reopens`, and step 5's reopen clause asks for the reopened label form without the close-under-the-entry half step 6 requires, so a triage-triggered reopen would drop the close the accumulation rule exists to keep. |
| 2026-09-21T09:32:00-04:00 | [claude-opus-5] `ad2bc5d` and `e62bd35` finished the reopen wording (F66, F67): the protocol's closing loop sentence now says any later event touching the report reopens it, and both Ready-whens point at `report-format.md#intro` for the reopened status instead of restating halves of the accumulation rule — the single-sourcing pattern of F45/F49/F59. |
| 2026-09-21T09:35:00-04:00 | [claude-opus-5] Round 28 raised F68: the status history is defined over `every state the review leaves`, but a first close leaves the opening `active`, which carries no timestamp and has no line form — while step 7's Ready-when demands that state stand under the entry. Docs-level; nothing for the scripts, which stay presence-only on **Status**. |
| 2026-09-21T09:40:00-04:00 | [claude-opus-5] `10417f9` gave the opening state a timestamp (F68): the **Status** label starts as `active since yyyy-mm-dd hh:mm`, `- active since …` joins the history line forms, and `scaffold-report.ts` stamps it from the clock when it creates the report — so a first close can record the state it left like any other. First clock value either script writes; the validator stays presence-only on **Status**. |
| 2026-09-21T09:42:00-04:00 | [claude-opus-5] Round 29 raised no findings — the first clean round of the series. Full re-read of all four files plus a fresh-scaffold round trip (scaffold → `update-dashboard.ts` exit 0, idempotent, new Status form present). The report's own status line migrated to the defined `active since 2026-09-18 10:40` form. |
