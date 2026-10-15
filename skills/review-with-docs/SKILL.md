---
name: review-with-docs
description: Runs a review as a document the user triages over rounds. Invoke only on explicit request — the user names this process, asks to triage a review report, asks for another round on one, or asks to publish its findings to a pull request. A plain "review this" does not qualify.
---

# Review with docs

The review lives in one SQLite database: findings, evidence, triage states,
round history, and links to pull request comments. The report is its
rendering — the document the user reads; the conversation only steers the
database.

The target is any changeset or text inside a git repository — a commit, a
range, a PR, a working tree, a set of files. The protocol does not assume a
PR; where the target has one, [pull-request.md](pull-request.md) adds reading
its comments and publishing findings.

**The user's call** is a stop: put the evidence and the options to the user,
and act on the answer.

## The tool

`pr-comments` below is `node <skill-dir>/pr-comments.mjs`, one file that
needs Node 24 or newer. Check `node --version` before the first command;
where Node is missing or older, it is the user's call — installing Node is
the expected outcome.

- Options and examples live in `pr-comments <command> --help`; read it before
  a command's first use.
- Descriptions go in as UTF-8 files and text arguments in single quotes:
  PowerShell rewrites backticks and `$` inside double quotes, and non-ASCII
  text piped to `--description-file -` can arrive as `?`.
- `report render` overwrites the report each time: change the review with
  commands, since an edit made in the report is lost.
- The orchestrator alone runs commands that change the review.
- Run every command in the reviewed repository: revisions resolve with git in
  the working directory.

## Protocol

A review database already in the repository means the request continues it:
read `finding list`, then start at the step the request calls for — a verdict
is step 5, a publish or sync request step 6, new changes (a moved PR head
included) step 7, a fix request the paragraph under States.

1. **Scope.** Take the target from the user or confirm it explicitly. Git is
   required — the rounds pin revisions and the review is committed — so where
   the target is not in a repository, it is the user's call;
   `git init` is the expected outcome. Pin the reviewed revision and the base
   it is read against: the first parent for a single commit, the endpoints
   for a range, the merge-base with the target branch for a PR, HEAD plus a
   dirty-tree note for an uncommitted tree, none for files reviewed as they
   stand. One attempt to resolve an ambiguous target or base, then the
   user's call — a wrong base silently changes the changeset under review.
   Where several review databases live in the repository, take the one whose
   title or `pr show` matches the target and pass `--db` on every command.
   With none, create one. Git must track the database and the report: before
   `init`, `git check-ignore` on the intended paths reports nothing — where
   it reports one, it is the user's call. Then `init <name>` — the report's
   title, derived from the review context (PR number, PR author, feature
   name) — with `--pr <url>` where the target is a pull request. That first
   pass reads the changeset without the PR's existing comments, so they
   cannot frame it; once the report is compiled, the user asks for the sync,
   and the comments enrich the report ([pull-request.md](pull-request.md)).
   **Ready when:** the database exists, and git ignores neither its path nor
   its report's (the `.md` it renders to, beside it by default); the reviewed
   revision and its base (or none) are pinned; on a pull request target,
   `pr show` names that pull request; and the user's target and base were
   confirmed or unambiguous.
2. **Instructions.** Enumerate every instruction file covering the changed
   paths — `AGENTS.md`, `CLAUDE.md`, editor rule files; repositories carry
   several, per directory — and pair each with the paths inside its scope.
   A review question the user raises opens a discussion; the check it settles
   on joins the rule set, is named in the round note in a few words, and
   carries into later rounds only where the user says so. A scope that is
   genuinely unclear is the user's call. The database stores no rules: the
   pairing travels in the briefs of a fleet ([fleet.md](fleet.md)). Then
   `round open --revision <pinned> (--base <rev> | --no-base) --note <text>`
   records round 1. The note cannot be amended, so it carries the dirty-tree
   remark, the scope with its exclusions, and the rule sources in one line —
   `dirty tree; scope: src/ without generated files; rules: AGENTS.md,
   src/AGENTS.md; agreed check: no network calls`.
   **Ready when:** every changed path is paired with every instruction file
   whose scope covers it, checks agreed with the user are in the rule set, and
   round 1 stands in the database with the reviewed revision, its base, and a
   note naming the rule sources — or `rules: none apply`, so an empty rule set
   never reads as an unfinished step.
3. **Validate.** Apply the rule set to the changeset under the Validation
   rules below.
   **Ready when:** every rule applied to every path its scope covers, every
   changed line outside the exclusions read for purpose and the ecosystem's
   best practices, and every finding evidenced or opened as ❓ unverified;
   with a fleet, the round's folder holds a coverage file per agent: one per
   rule, plus purpose fit and best practices.
4. **Record.** `finding add --severity --title --description-file` records
   each finding in the open round, with `--unverified` where its evidence
   stayed unsettled — a fleet's reply line marks it ❓; the description follows
   [Evidence](#evidence). With a fleet, findings on a shared anchor merge per
   [fleet.md](fleet.md). An empty pass is a result: render the report and tell
   the user.
   **Ready when:** every finding carries severity, evidence, and a suggested
   fix in its description, `finding list` shows each of them, the review is
   [checkpointed](#checkpoint), and the user has the report's path.
5. **Triage.** The user triages from the report — handed over at the end of
   step 4 — in the order and at the pace the user chooses; the agent answers
   the questions that precede a verdict, walks through findings when asked,
   and records each verdict the user gives. Write each verdict with
   `finding set-state <F> <state> --note <why> --round <n>`, `<n>` the round
   being triaged: ✅ approved, ❌ discarded, 📌 deferred, 🔀 routed out as an
   improvement. An answer that changes a finding rewrites it —
   `set-description`, `set-severity`, `set-title`, each with a note; a
   question or a remark that moves nothing goes in as `finding update`. A
   finding the user brings in, or one a triage question surfaces, is a
   `finding add` carrying the same evidence — text or screenshots from the
   user are transcribed in substance — and is filed in the round just triaged.
   The user may rule on part of the findings; the rest keep their state.
   **Ready when:** every finding the user ruled on carries its state and an
   Updates entry saying why, every finding raised during the triage is
   recorded, and the review is checkpointed.
6. **Publish** — a pull request target, on the user's request: approved
   findings go to the PR as comments, and what others wrote is linked to the
   review. The triage batch the user just ruled on may be partial, and its
   approved findings can go out before the rest are ruled. Follow
   [pull-request.md](pull-request.md).
   **Ready when:** `finding list --state approved --unposted` lists only
   findings the user chose to hold back or whose refused post is the user's
   call; `link pending` prints nothing; the user knows the pending review
   waits for their submit; and the review is checkpointed.
7. **Re-review.** A round opens on the user's call: new changes landed in the
   reviewed area, which the user reports or picks up by syncing the PR;
   where in doubt, it is the user's call. A pull request target is synced
   first (`pr sync`, then `link pending` for what is new), so the round sees
   what others wrote. Where the new work is really a different target, that
   is the user's call.
   Every round reads the **full changeset** at the new revision — never a
   diff between revisions, because authors amend and force-push and
   per-commit attribution misleads. `round open --revision --base --note`
   records it — the note carries the scope, the rule sources where the
   instruction files changed, and any narrowing — then every open finding
   (⏳ ❓ ✅) and every fixed one, since a fix regresses, is re-checked, and
   the changeset is searched afresh for what nobody has raised yet. A closed
   finding (❌ 📌 🔀) is re-checked where the code it points at changed: only
   changed ground overturns the user's ruling, and a concern that returns
   with better evidence is a new finding naming the old one, whose state
   stands until the user rules. Each outcome is an Updates entry carrying
   `--round <n>` — `finding update`, or `set-state` where the state moves,
   `fixed` per [States](#states). Comparing revisions serves one purpose:
   telling where the code the findings point at changed.
   The user may narrow a round to some findings or paths; the re-check covers
   that subset.
   **Ready when:** the round stands in the database with its revision, its
   base, and a note carrying any narrowing; step 3's Ready-when holds for the
   round's scope at the new revision; every finding the re-check covers
   carries a `Round <n>:` entry; on a pull request target, `link pending`
   prints nothing; and the review is checkpointed.

Steps 5 to 7 are a loop: the round step 7 opens is triaged from step 5.

## States

A finding's state is the word `set-state` takes; any state can follow any
other, and every change carries its reason in `--note`, so an odd move shows
in the finding's own history.

| Marker | State | Meaning |
|---|---|---|
| ⏳ | `awaiting` | raised, no verdict yet |
| ❓ | `unverified` | reasonable, neither shown nor refuted — the user's call |
| ✅ | `approved` | the user agreed it is a finding; the findings to publish |
| 🔧 | `fixed` | the changeset now addresses it; `--revision` names where |
| ❌ | `discarded` | not a finding; the note holds the rationale |
| 📌 | `deferred` | valid, consciously left as it is |
| 🔀 | `improvement` | valid, routed outside this changeset |

**Fixed** is reached two ways. When the PR moves, the user's sync opens a
round (step 7), and the agent decides, finding by finding, from the code at
the new revision: wide, the findings step 7 re-checks unless the round note
narrows it. When the user asks for a fix, the agent implements it, commits it
apart from the review files, and verifies it the way the finding was verified
— the same test, trace or measurement now comes out clean: narrow, the finding
named, and the next round's re-check at the pushed head confirms it. Both end
in `set-state <F> fixed --revision <rev> --note <how verified>`, with
`--round <n>` for the first only, and the review is checkpointed.

## Validation

- A **rule** is one enforceable statement — a single bullet of an instruction
  file, or one check agreed with the user.
- Iterate every changed line: does it serve the change's purpose, and does it
  meet the rules covering its path and the ecosystem's best practices?
- Files nobody wrote by hand stay out of the line-by-line pass: the review's
  own files, and generated or vendored files, recognized by
  `linguist-generated` or `linguist-vendored` in `.gitattributes` or by a
  "generated — do not edit" header. A changed generated file gets one check:
  did its source change with it? The round note's scope names the exclusions,
  so the user can overrule them; a file in doubt is the user's call.
- Challenge the implementation. A review that summarizes the diff finds
  nothing.
- Past a handful of files or a few hundred changed lines, dispatch a fleet
  per [fleet.md](fleet.md).
- Severity: 🔴 high breaks or violates a rule, 🟡 medium risks harm under
  realistic conditions, ⚪ low is polish or a suggestion.

## Evidence

Every finding carries a verbatim snippet from the reviewed revision, with
file path and lines; multiple occurrences are each illustrated. Where the
finding is an absence — a missing test, guard, or accessible name — the
snippet shows the site that should carry it. Paraphrased code hides the very
drift the review exists to catch.

The description is what a reader meets — in the report and, once published, in
the pull request — so it says what is wrong, where, and what to do, nothing
more. It is laid out as:

- A line holding only `` `path:lines` `` opens it — the anchor, the place of
  the pull request comment. A finding about a whole file anchors at `path:1`
  where the PR adds the file, and at its first changed line where the PR
  only changes it: GitHub takes a comment only inside a diff hunk.
- The explanation, the snippet in a closed code fence, the suggested fix.
- Each further occurrence gets its own anchor line and snippet.
- Headings (`#`) stay inside code fences, and links stay absolute: a
  relative link points into the review, which the PR's author cannot open.

Verify before claiming: run the test, trace the call path, measure the value.
An assumption reaches the review along one of two paths — verified (a case
that shows the problem) or falsified (a case that shows there is none) — and
either settles it. An assumption that is reasonable, its mechanism stated,
yet can be neither shown nor refuted because both attempts are blocked, is the
user's call: it opens as a ❓ unverified finding that states the mechanism,
what was tried to prove it and to refute it and why each failed, and what
would settle it. Its severity is its impact if it holds. An unproven concern
dropped silently is a defect of the review.

## Checkpoint

Commit what the review produced, nothing else. A checkpoint is
`report render`, then one commit of the database, the report and the round's
folder to the current branch, which the user prepares for the review: the
commits are a backup that stays out of the main branch. Only the database
and the report together are a complete state. Every commit the agent makes,
a fix commit included, names its paths (`git commit -m <message> -- <paths>`)
so that staged work stays out.
