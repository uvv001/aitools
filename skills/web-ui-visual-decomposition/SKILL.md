---
name: web-ui-visual-decomposition
description: Decomposes a mockup or live UI into an approved component plan. Trigger when planning a screen or feature from a visual reference, or when an implementation specification needs its decomposition first.
---

# Web UI visual decomposition

Turn a visual reference into an approved decomposition plan: every screen
element observed and measured, each mapped to existing components, open
decisions resolved or parked.

## Inputs

Collect before observing; ask where any is missing.

- **Reference** — live URL, static captures, or both. Both is the strong
  form: captures anchor the layout, the live page answers state questions.
- **Scope** — what is in, and an explicit out-of-scope list.
- **Proposed structure** (optional) — the user's element list or layout idea.
  It seeds the inventory; the reference may extend, rename, or discard it.
- **Paths to state** — how to reach each non-default state on the live
  reference (roles, click paths, data conditions).

## Protocol

1. **Frame.** Enumerate the screen's elements from the reference, merging in
   the proposed structure, and give each a working name.
   **Ready when:** every visible element sits in the inventory.
2. **Observe.** Declare a fixed viewport (the project's declared floor, else
   1280×720) and dispatch a **fleet**: one inspector per element — the
   `web-ui-inspector` agent when installed, otherwise a subagent carrying
   [inspector-brief.md](inspector-brief.md) as its prompt. One element per
   dispatch is what keeps a state matrix complete. Drive the live reference to
   each state before measuring, and visit multiple occurrences of an element
   to widen the observed state range. Observation reveals elements the frame
   missed: add them to the inventory and dispatch for them.
   **Ready when:** every element carries measured values and a per-state
   matrix, or a BLOCKED entry naming its cause.
3. **Map.** For each element, search the codebase for composition fits and
   record a verdict: reuse as-is, extend, rename, or extract-new. Where a new
   shared component replaces an existing custom structure, name the adoption
   targets. Propose better names, splits, or behavior changes when the
   reference demands them.
   **Ready when:** every element has a verdict backed by file-level evidence.
4. **Decide.** Resolve open questions from the evidence; park the rest as
   explicit questions for the user.
   **Ready when:** every question is decided or parked — none left implicit.
5. **Write** the document per
   [decomposition-format.md](decomposition-format.md).
   **Ready when:** every section exists and every claim traces to an
   observation or a code path.
6. **Gate.** Present the document, revise, and re-present until the user
   approves. An edit to approved content clears that section's mark.
   **Ready when:** approval is explicit; specification and implementation
   begin outside this skill.

## Guardrails

- **Report variants; pin later.** Describe elements with examples and their
  available variants; value pinning belongs to the specification stage.
  Research-stage precision reads as commitment and invites rework.
- **The reference is the oracle.** Where convention and the reference
  disagree, the reference's behavior is the finding; record deliberate
  departures as decisions with reasons.
- **Name from the observation.** A strip that never collapses is a section —
  the name follows what the reference does.
- **Unobserved behavior is UNKNOWN.** A guessed interaction reads as a
  finding and misleads worse than silence.
- **Spec only what the reference shows.** An element with no occurrence in
  the reference is flagged unverified or moved to the out-of-scope list.
