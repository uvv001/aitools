# Commit / PR / diff review

Assess a changeset for correctness and rule compliance, challenging the
implementation rather than summarizing it.

## Scope forms

- Last commit, a named commit or range, a PR diff, or the working tree.
- Pin the exact reviewed revision (full SHA) — the report cites it and
  later rounds diff against it.

## Validation

- Build the rule set from every instruction file paired with the changed
  paths (SKILL.md step 2); add the user's explicit review questions.
- Iterate every changed line: does it serve the change's purpose, and does
  it meet the applicable rules and best practices?
- Dispatch the fleet for anything beyond a trivial diff: one agent per rule,
  each scoped to the paths that rule covers. A narrow, single-rule brief is
  what keeps an agent's verdict checkable.
- Verify before claiming: run the test, trace the call path, measure the
  value. Where verification is impossible, mark the finding UNVERIFIED and
  say what would settle it.
- Challenge severity: a style preference reported as HIGH reads as noise.
  🔴 breaks or violates a rule, 🟡 risks harm under realistic conditions,
  ⚪ is polish or a suggestion.

## Evidence

Every finding carries a verbatim snippet from the reviewed revision, with
file path and lines. Multiple occurrences are each illustrated. A finding
without evidence is an opinion; either gather the evidence or drop the
finding.
