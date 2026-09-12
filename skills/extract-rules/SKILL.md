---
name: extract-rules
description: Extract durable lessons from session work into rules, guides, or skill candidates. Use when asked to extract or preserve lessons, update AGENTS.md or instruction files from recent work, propose rules for review, or research past sessions for extraction candidates.
---

# Extract rules

Distill session work into durable rules. The default motion is **propose, then
persist**: destinations stay untouched until the user approves specific items.
When the user supplies the exact rule text, skip to applying it — after the
validation check in step 3.

**Multi-session:** When the ask spans past sessions ("research my sessions",
"extract patterns from my history"), follow [research-mode.md](research-mode.md);
this file covers the single live session.

## 1. Gather candidate lessons

Scan the session for: user corrections and review feedback, dead ends and
retries, surprises from compilers/CI/tooling, conventions that had to be
enforced repeatedly, and decisions with lasting rationale. Consult linked
artifacts (plans, diffs, reports) when they carry the evidence.

Hold each candidate to the durability bar: durable over transient (a
component-specific detail or historical narration is not a lesson), non-obvious
over easily rediscoverable, validated over speculative. Anchor each survivor in
evidence: what happened, and where (file, commit, turn).

**Ready when:** every candidate carries draft rule text, its evidence, and a
proposed destination.

## 2. Propose for review

Present the candidates as a numbered list grouped by destination class: project
rules (AGENTS.md / copilot-instructions), workflow guide, new skill or subagent,
saved prompt. Each entry: ID, destination, draft text, evidence, and your value
rank with one line of triage ("most non-obvious: 1, 4"). New-entity candidates
add Trigger, Purpose, and Boundary. Open with "Nothing written yet — this is
for your review."

**Ready when:** the user can approve by index alone ("Approved: 1,3") and knows
the ranking is advisory.

## 3. Apply approved items only

Validate testable rules empirically before codifying (compile or run the claim).
When validation contradicts a requested rule, report the evidence and ask the
user; leave destinations unchanged until they decide.

Choose the closest-scoped destination: glob for the AGENTS.md hierarchy and pick
the file nearest the lesson's scope. Insert rules as imperative bullets into an
existing section, with the reason embedded in the bullet; create a section only
when no home exists. Match the destination file's voice.

Offer a wording stage when the user engages on phrasing or supplies a rule
seed: write the exact text, hold the commit, and wait for confirmation.

**Ready when:** each approved item is written (or its exact wording awaits the
user's confirmation) and nothing unapproved reached a destination.

## 4. Verify and commit separately

Re-read each changed region and run `git diff --check`. Commit rule changes as
their own docs commit, separate from feature work, with the repo's co-author
trailer convention. Report the final wording and commit id per item.

**Ready when:** destinations contain exactly the approved set, verified, and the
user holds the commit ids.
