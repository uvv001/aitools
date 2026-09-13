---
name: web-ui-visual-decomposition
description: Decomposes a live web UI or mockup into a component plan document. Trigger when breaking a screen or feature down into components from a visual reference, or when a decomposition document must win explicit approval before specification or implementation begins.
---

# Web UI visual decomposition

Turn a visual reference into an approved decomposition document: every screen
element observed and measured, each mapped to existing components, open
decisions resolved or parked. The document is the deliverable; explicit user
approval is the exit. Specification and implementation are downstream stages
outside this skill.

## Inputs

Collect before observing; ask where any is missing.

- **Reference** — live URL, static captures, or both. Both is the strong
  form: captures anchor the layout, the live page answers state questions.
- **Scope** — what is in, and an explicit out-of-scope list. Items dropped
  mid-work stay listed as out of scope so the document keeps the boundary.
- **Proposed structure** (optional) — the user's element list or layout idea.
  It seeds the inventory; the reference may extend, rename, or discard it.
- **Paths to state** — how to reach each non-default state on the live
  reference (roles, click paths, data conditions).

## Protocol

1. **Frame.** Enumerate the screen's elements from the reference, merging in
   the proposed structure, and give each a working name.
   Done when every visible element sits in the inventory.
2. **Observe.** Declare a fixed viewport (the project's declared floor, else
   1280×720) and dispatch one inspector per element — the `web-ui-inspector`
   agent when installed, otherwise a generic subagent carrying
   [inspector-brief.md](inspector-brief.md) as its prompt. Dispatch in
   parallel where tooling allows: one element per dispatch is the granularity
   that keeps state matrices complete. Drive the live reference to each state
   before measuring, and find multiple occurrences of an element to widen the
   observed state range.
   Done when every element carries measured values and a per-state matrix, or
   a BLOCKED entry with its cause.
3. **Map.** For each element, search the codebase for composition fits and
   record a verdict: reuse as-is, extend, rename, or extract-new. Where a new
   shared component replaces an existing custom structure, name the adoption
   targets. Propose better names, splits, or behavior changes when the
   reference demands them.
   Done when every element has a verdict backed by file-level evidence.
4. **Decide.** Resolve open questions from the evidence and park the rest as
   explicit questions for the user; ask where the desired outcome is
   ambiguous.
   Done when every question is decided or parked — none left implicit.
5. **Write** the document per
   [decomposition-format.md](decomposition-format.md).
   Done when every section exists and every claim traces to an observation or
   a code path.
6. **Gate.** Present the document for review and stop. Specification or
   implementation begins only on explicit approval.

## Guardrails

- **Report variants; pin later.** Describe elements with examples and their
  available variants; value pinning belongs to the specification stage.
  Research-stage precision reads as commitment and invites rework.
- **The reference is the oracle.** Where convention and the reference
  disagree, the reference's behavior is the finding; record deliberate
  departures as decisions with reasons.
- **Name after what is observed**, not the behavior first assumed — a static
  strip is not an accordion.
- **Unobserved behavior is UNKNOWN.** A guessed interaction reads as a
  finding and misleads worse than silence.
- **Spec only what the reference shows.** An element with no occurrence in
  the reference is flagged unverified or moved to the out-of-scope list.
