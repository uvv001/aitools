---
name: review-with-docs
description: Reviews code changes and drives the findings-triage loop through a report document that carries the process. Trigger when asked to review a commit, PR, or diff, to re-review an updated PR, or to triage review findings.
---

# Review with docs

The report document is the driver of the review: findings, evidence, triage
states, and round history all live there; the conversation only steers it.

## Scope

The review target is defined by the user or explicitly confirmed before any
findings are produced. When the request leaves the target ambiguous — which
commit, which base — confirm it first; a wrong scope wastes a full review
pass. The review itself follows [commit-review.md](commit-review.md).

## Protocol

1. **Scope.** Take the target from the user or confirm it explicitly.
   **Ready when:** target commit(s) and base are explicit.
2. **Instructions.** Enumerate every `AGENTS.md` or scoped instruction file
   covering the changed paths — repositories carry several, per directory —
   and apply each to the paths inside its scope.
   **Ready when:** every changed path is paired with every instruction file
   whose scope covers it.
3. **Validate.** Follow [commit-review.md](commit-review.md). For large
   diffs, dispatch a fleet — one agent per rule — each returning verdicts backed by
   verbatim snippet evidence from the reviewed revision. Verify before
   claiming: an assumption reported as fact is a report defect worse than a
   missed finding.
   **Ready when:** every rule applied to every covered path, every finding
   evidenced.
4. **Write** the report per [report-format.md](report-format.md).
   **Ready when:** every finding carries ID, severity, evidence, and
   suggested fix, and the dashboard separates fix progress from triage state.
5. **Triage.** Apply user verdicts to the document: approved findings stay in
   place, discarded ones move to the resolved section — never deleted —
   deferred and routed-out ones get their markers. Record each verdict as a
   dated entry under the finding's Updates.
   **Ready when:** every finding header carries its state.
6. **Re-review.** On a PR update, open a new round: re-check surviving
   findings against the new revision and report both persisting and new
   findings under per-round IDs. Prior rounds stay intact.
   **Ready when:** the document shows the full review/feedback/fix history.

## Guardrails

- **Hold the index, not the findings.** Fleet reports persist to files; your
  context holds which agent produced which verdicts. Assemble the report
  from the files, reading one back only when the write needs it.
- **The document is the deliverable.** Conversation proposes; the document
  disposes. A decision that never reaches the document is lost.
- **Snippet evidence verbatim.** Paraphrased code hides the very drift the
  review exists to catch.
