---
name: extract-rules
description: Extract durable lessons from session work into rules. Use when asked to preserve lessons or update AGENTS.md from recent work, or to mine past sessions for rule candidates.
---

# Extract rules

Turn what the session taught into rules the next session inherits. A **lesson**
is what happened; a **rule** is the imperative it becomes. Lessons are
**proposed**; only approved ones are **persisted**.

When the user supplies the rule text already, carry it straight to step 3.

**Past sessions:** When the ask spans session history rather than the live
session, follow [research-mode.md](research-mode.md).

## 1. Gather lessons

Mine the session's friction: corrections the user made, dead ends and retries,
surprises from compilers, CI, and tooling, conventions that needed repeated
enforcement, decisions whose rationale outlives the decision.

Hold each to the durability bar: a lesson outlives the component that taught it,
stays non-obvious to whoever would otherwise learn it the hard way, and holds up
when tested. Anchor each lesson you keep in evidence — what happened, and where
(file, commit, turn).

**Ready when:** every point of friction is judged keep-or-drop, and each kept
lesson carries draft rule text, its evidence, and a destination.

## 2. Propose

Present the lessons as a numbered list grouped by destination: project rules
(the repo's agent instruction file), workflow guide, new skill or subagent,
saved prompt. Each entry carries its destination, draft rule text, evidence, and
your value rank with one line of triage ("most non-obvious: 1, 4") — the rank is
advisory, and the user overrides it freely. A skill or subagent candidate adds
Trigger, Purpose, and Boundary.

Open with "Nothing written yet — this is for your review."

**Ready when:** every lesson carries its number, a draft, and evidence, and every
destination file is still untouched.

## 3. Persist the approved

Validate a testable rule before codifying it: compile or run the claim. When the
result contradicts the rule, report the evidence and ask the user, leaving
destinations as they stand.

Write each approved rule to the closest-scoped destination: glob the
instruction-file hierarchy and pick the file nearest the lesson's scope; when the
repo has none, create one where the agent already reads them. Rules land as
imperative bullets inside an existing section with the reason embedded in the
bullet; a new section earns its place only when no section fits.

Offer a wording stage when the user engages on phrasing or supplies a rule seed:
write the exact text, hold the commit, wait for confirmation.

**Ready when:** every approved rule is written, or its wording awaits the user's
confirmation.

## 4. Verify and commit

Re-read each changed region and run `git diff --check`. Rules ship as their own
docs commit, separate from feature work. Report the final wording and commit id
per rule.

**Ready when:** destinations contain exactly the approved set, and the user holds
the commit ids.
