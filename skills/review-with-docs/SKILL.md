---
name: review-with-docs
description: Reviews code changes and drives the findings-triage loop through a report document that carries the process. Trigger when asked to review a changeset, re-review an updated PR, or triage findings.
---

# Review with docs

The report document is the driver of the review: findings, evidence, triage
states, and round history all live there; the conversation only steers it.

## Protocol

1. **Scope.** Take the target from the user or confirm it explicitly — last
   commit, a named commit or range, a PR diff, or the working tree. Pin the
   reviewed revision by full SHA: the report cites it and later rounds diff
   against it.
   **Ready when:** the reviewed revision and its base are pinned.
2. **Instructions.** Enumerate every `AGENTS.md` or scoped instruction file
   covering the changed paths — repositories carry several, per directory —
   and pair each with the paths inside its scope. The user's explicit review
   questions join the rule set.
   **Ready when:** every changed path is paired with every instruction file
   whose scope covers it.
3. **Validate.** Apply the rule set to the changeset under the Validation
   rules below.
   **Ready when:** every rule applied to every covered path, and every
   finding evidenced or marked ❓ unverified.
4. **Write** the report per [report-format.md](report-format.md), then commit
   it.
   **Ready when:** every finding carries ID, severity, evidence, and a
   suggested fix, and the report is committed.
5. **Triage.** Present the findings for verdict and answer the questions that
   precede one — an answer that changes a finding rewrites its description.
   Apply each verdict: approved findings stay in place, discarded ones move
   to the resolved section, deferred and routed-out ones take their markers.
   **Ready when:** every finding the user ruled on carries its verdict marker
   and a dated Updates entry.
6. **Re-review.** On a PR update, open a new round: re-check every prior
   finding against the new revision, and add the findings the update
   introduced.
   **Ready when:** every prior-round finding carries a re-check entry against
   the new revision, and every new finding carries a round ID.

## Validation

- Iterate every changed line: does it serve the change's purpose, and does it
  meet the rules covering its path?
- Challenge the implementation. A review that summarizes the diff finds
  nothing.
- Dispatch a fleet for anything beyond a trivial diff: one agent per rule,
  each scoped to the paths that rule covers. A narrow, single-rule brief is
  what keeps an agent's verdict checkable.
- Severity: 🔴 breaks or violates a rule, 🟡 risks harm under realistic
  conditions, ⚪ is polish or a suggestion. A style preference reported as 🔴
  reads as noise.

## Evidence

Every finding carries a verbatim snippet from the reviewed revision, with
file path and lines; multiple occurrences are each illustrated. Paraphrased
code hides the very drift the review exists to catch.

Verify before claiming: run the test, trace the call path, measure the value.
An assumption reaches the report along one of two paths — verified or
falsified — and either settles it. Where both attempts fail, the assumption
survives as a ❓ unverified finding stating what was tried and what would
settle it, and the user makes the call. This holds hardest where a wrong
assumption carries serious consequences: an unproven concern raised is a
finding; the same concern dropped silently is a defect of the review.

## Guardrails

- **Hold the index, not the findings.** Fleet reports persist to files; your
  context holds which agent produced which verdicts. Assemble the report
  from the files, reading one back only when the write needs it.
- **The document is the deliverable.** Conversation proposes; the document
  disposes. A decision that never reaches the document is lost.
