---
name: review-with-docs
description: Runs a review as a document — findings, evidence, triage states, and round history live in a report file the agent maintains across rounds. Invoke only on explicit request — the user names this process, asks to triage a review report, or asks for another round on one. A plain "review this" or a self-initiated check does not qualify.
---

# Review with docs

The report document is the driver of the review: findings, evidence, triage
states, and round history all live there; the conversation only steers it.

The target is any changeset or text inside a git repository — a commit, a
range, a PR, a working tree, a set of files. Nothing in the protocol assumes
a PR.

## Protocol

1. **Scope.** Take the target from the user or confirm it explicitly. Git is
   required — the rounds pin revisions and the report is committed — so where
   the target is not in a repository, stop and raise it with the user;
   `git init` is the expected outcome. Pin the reviewed revision and the base
   it is read against: the first parent for a single commit, the endpoints
   for a range, the merge-base with the target branch for a PR, HEAD plus a
   dirty-tree note for an uncommitted tree, none for files reviewed as they
   stand. One attempt to resolve an ambiguous target or base, then ask the
   user — a wrong base silently changes the changeset under review.
   **Ready when:** the reviewed revision and its base stand in the report's
   intro.
2. **Instructions.** Enumerate every instruction file covering the changed
   paths — `AGENTS.md`, `CLAUDE.md`, editor rule files; repositories carry
   several, per directory — and pair each with the paths inside its scope.
   The user's explicit review questions join the rule set. Ask where a scope
   is genuinely unclear.
   **Ready when:** the report's intro pairs every changed path with every
   instruction file whose scope covers it.
3. **Validate.** Apply the rule set to the changeset under the Validation
   rules below.
   **Ready when:** every rule applied to every path its scope covers, and
   every finding evidenced or opened as ❓ unverified.
4. **Write** the report per [report-format.md](report-format.md). Scaffold the
   document with [`scaffold-report.ts`](scaffold-report.ts) — the structure
   both scripts depend on — and fill it in. Every finding opens at ⏳
   awaiting triage — ❓ where its evidence stayed unsettled. A pass that found
   nothing still writes the report and says so; findings invented to fill it
   are worse than an empty round.
   **Ready when:** every finding carries ID, severity, evidence, a suggested
   fix, and a `Round 1:` Updates entry, the dashboard is regenerated with
   [`update-dashboard.ts`](update-dashboard.ts), and the report is committed.
5. **Triage.** Present the findings for verdict and answer the questions that
   precede one — an answer that changes a finding rewrites its description.
   Write each verdict into the finding's header: ✅ approved, ❌ discarded,
   📌 deferred, 🔀 routed out as an improvement. A finding the user brings in,
   or one a triage question surfaces, takes the next free ID and joins the
   round just triaged; triage opens no round of its own.
   **Ready when:** every finding the user ruled on carries its state in the
   header and an Updates entry explaining the move, every finding raised
   during the triage carries a `Round <n>:` entry for that same round, the
   dashboard is regenerated, and the report is committed.
6. **Re-review.** A round opens when new changes land in the reviewed area;
   confirm with the user when in doubt. Every round reads the **full
   changeset** at the new revision — never a diff between revisions, because
   authors amend and force-push and per-commit attribution misleads. Re-check
   every finding the report carries, whatever its state, and search the
   changeset afresh for what nobody has raised yet. Comparing revisions
   serves one purpose: telling whether the feedback was acted on. No state
   survives by default — a fix regresses, a deferred finding gets addressed,
   a discarded concern returns with better evidence.
   **Ready when:** every finding carries a `Round <n>:` Updates entry, new
   findings continue the report's ID sequence, the round's revision stands in
   the intro, the dashboard is regenerated, and the report is committed.
7. **Close.** The review ends when the user closes it. Set the intro's status
   to closed with the date and the final revision, and leave every finding in
   the state it reached; ⏳ and 📌 at the close are a result, not an
   oversight.
   **Ready when:** the intro's status reads closed, the dashboard is
   regenerated, and the last commit is recorded.

Steps 5 and 6 are a loop: each round's findings are triaged, each change in
the reviewed area opens the next round, and the review runs until step 7.

## Validation

- A **rule** is one enforceable statement — a single bullet of an instruction
  file, or one explicit question from the user. Not a file, not a section.
- Iterate every changed line: does it serve the change's purpose, and does it
  meet the rules covering its path and the ecosystem's best practices?
- Challenge the implementation. A review that summarizes the diff finds
  nothing.
- Dispatch a fleet once the changeset outgrows a handful of files or a few
  hundred changed lines: one agent per rule, each scoped to the paths that
  rule covers, plus two agents no instruction file covers — one for purpose
  fit, one for the ecosystem's best practices. A narrow, single-rule brief is
  what keeps an agent's verdict checkable.
- Every brief carries the rule verbatim, the paths in its scope, the pinned
  revision, the Evidence rules below, the severity scale, and the file the
  agent writes its findings to.
- Severity: 🔴 high breaks or violates a rule, 🟡 medium risks harm under
  realistic conditions, ⚪ low is polish or a suggestion. A style preference
  reported as 🔴 reads as noise.

## Evidence

Every finding carries a verbatim snippet from the reviewed revision, with
file path and lines; multiple occurrences are each illustrated. Where the
finding is an absence — a missing test, guard, or accessible name — the
snippet shows the site that should carry it. Paraphrased code hides the very
drift the review exists to catch.

Verify before claiming: run the test, trace the call path, measure the value.
An assumption reaches the report along one of two paths — verified or
falsified — and either settles it. Where both attempts fail, the assumption
opens as a ❓ unverified finding stating what was tried and what would settle
it, and the user makes the call. This holds hardest where a wrong
assumption carries serious consequences: an unproven concern raised is a
finding; the same concern dropped silently is a defect of the review.

## Guardrails

- **Hold the index, not the findings.** Fleet reports persist beside the
  review report — `<report-stem>/round-<n>/<rule>.md`, where `<report-stem>`
  is the report's file name without `.md` and `<rule>` a short slug of the
  rule, e.g. `2026-09-16_pr157_review/round-1/agents-self-sufficiency.md`;
  create the folders as needed. They are committed with the report; your
  context holds which agent produced which verdicts. Assemble the report from
  the files, reading one back only when the write needs it.
- **The dashboard is generated, never typed.**
  [`update-dashboard.ts`](update-dashboard.ts) rewrites it from the finding
  headers; run it after every write to the findings. Node 24 or newer runs it
  and [`scaffold-report.ts`](scaffold-report.ts) directly — `node
  <skill-dir>/update-dashboard.ts <report.md>` — so check `node --version`
  before the first write, and where Node is missing or older, stop and raise
  it with the user; installing Node is the expected outcome. There is no
  fallback: never hand-count the section, never skip it.
- **Commit what the review produced, nothing else.** The report and its
  artifacts go to the current branch; record every commit in the report's
  intro, because a reviewed branch is often rebased or force-pushed and the
  SHAs are what let you restore the document.
- **The document is the deliverable.** Conversation proposes; the document
  disposes. A decision that never reaches the document is lost.
