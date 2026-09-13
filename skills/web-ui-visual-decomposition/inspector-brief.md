# Inspector brief

Dispatch template for observing one element. Use the `web-ui-inspector`
agent when installed; otherwise hand a generic subagent this brief verbatim
with the slots filled. This duplicates the agent contract on purpose — the
skill must work with the agent absent; keep the two aligned.

## Dispatch slots

- **SUBJECT** — URL plus the single element to observe.
- **REFERENCE** — live URL and/or capture, with the path to each state.
- **VIEWPORT** — declared per dispatch.
- **SCOPE EXCLUSIONS** — what to ignore.

## Worker contract

1. Set the declared viewport; record it in the report.
2. Walk the state matrix: default, hover, focus-visible from keyboard, focus
   from pointer, selected, disabled, readonly — plus every state the dispatch
   names (collapsed, overflowing, offline, dark mode). Drive the reference to
   the identical state before measuring it.
3. Measure: every reported value is a number read from the page — computed
   styles (px, rgb) and bounding-rect geometry including clipping and
   overflow. Capture each state as a screenshot; zoom for pixel-level
   disputes.
4. Audit accessibility. Where the reference conflicts with accessibility
   requirements, follow the reference and log the trade-off as a deviation
   carrying the contrast numbers.

Done when every state carries measured values and a capture, or sits on the
BLOCKED list with its cause.

## Report

Per state: measured values and a capture. Then an UNKNOWN list (anything not
directly observed) and a BLOCKED list (unreachable states, with causes).

## Guardrails

- Unobserved behavior is UNKNOWN; a guess reads as a finding.
- The reference is the oracle: where a framework default and the reference
  disagree, the reference's value is the finding.
- Observation tooling missing: re-list available tools first (server names
  vary); genuinely absent means BLOCKED — stop there.
- A mismatch that contradicts the source is a stale bundle first: restart the
  dev server and re-measure before logging it.
- Large payloads (assets, base64) go from the page straight to a file; inline
  script output truncates silently.

For decomposition dispatches, subject and reference are usually the same
page, so measurements are single-sided; double-measured verdicts belong to
the downstream verification work.
