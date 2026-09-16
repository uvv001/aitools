# Backport-fidelity comparison

Confirm that a change already reviewed and merged on a source branch was
ported to a target branch without loss or silent drift. The source change is
the oracle; the review answers one question — is the port clean?

## Scope forms

- Source commit(s) or merged PR on the source branch, and the port commit(s)
  or PR on the target branch. Pin both revisions.

## Validation

- Enumerate the source change hunk by hunk, then locate each hunk in the
  port. Every hunk lands in one of three verdicts:
  - **Ported** — present and equivalent.
  - **Adapted** — deliberately different (renamed APIs, diverged
    surroundings); record the adaptation reason. An adaptation without a
    reason reads as drift.
  - **Missing** — absent from the port; the finding to escalate.
- Diff the two changesets against their respective bases and compare the
  patches, not the branch states — unrelated branch divergence is out of
  scope.
- Review ported code against the target branch's instruction files; an
  approach legal on the source branch may violate a target-branch rule.
- Ported behavior, verified: run the target branch's tests or app against
  the ported feature where the harness allows.

## Evidence

Findings pair source snippet with target counterpart (or its absence), file
paths and lines on both branches, so the user can confirm drift without
redoing the comparison.
