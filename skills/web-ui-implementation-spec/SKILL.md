---
name: web-ui-implementation-spec
description: Compiles an approved plan into an implementation specification, per-component contracts with pinned values. Trigger when a plan or decomposition is approved and implementation has not started.
---

# Web UI implementation specification

Turn an approved plan into an implementation specification: a document whose
per-component sections each carry everything needed to build that component
without re-reading the research. Where the plan reported variants, the
specification pins values.

## Inputs

Collect before writing; ask where any is missing.

- **Approved plan** — scope in and out, fixed decisions, a component
  inventory in implementation order, and the existing structures each new
  component replaces. Its decided questions are closed.
- **Reference** — the live URL, static captures, or both, that the plan
  observed. Pinning measures against it.
- **Project conventions file** — the rules implementation must satisfy:
  structure, testing, demo/showcase workflow, localization, review checklist.

## Protocol

1. **Absorb.** Read the approved plan end to end, then the conventions file.
   Extract the fixed decisions, the scope boundary, and the inventory in
   implementation order, marking every value the plan deliberately left open.
   **Ready when:** the marked values form the pinning worklist, and every
   inventory item appears on it or is recorded as already pinned.
2. **Pin.** Verify every marked value against the reference: per-state
   geometry, colors, tokens, content. Dispatch one `web-ui-inspector` agent
   per component that needs pinning — one component per dispatch keeps a
   state matrix complete. Drive the live reference to each state before
   measuring.
   **Ready when:** every state of every component maps to a reference
   location and a pinned value, or carries an explicit no-reference flag.
3. **Write** the whole document per
   [references/implementation-spec-format.md](references/implementation-spec-format.md):
   intro, implementation process, then one section per component in
   implementation order.
   **Ready when:** every component section answers reference locations, API
   with closed value sets, rendering and accessibility, verified tokens,
   tests, demo page, and consumer adoption, and every pinned value traces to
   a reference location or a plan decision. A mechanism-open section
   substitutes requirements and consumption scenarios for the API — the one
   part that may be absent.
4. **Unify.** Read the sections as a set: the only pass that catches what
   writing them one at a time hides. Repeated internal structure becomes a
   composition proposal, a concern several components share gets one
   treatment, and colliding terms collapse to one with the choice recorded.
   **Ready when:** every repetition across sections is extracted, composed,
   or justified in place.
5. **Gate.** Present the whole document for section-by-section review.
   Revise and re-present until the user approves. An edit to approved
   content clears that section's ✅ mark.
   **Ready when:** approval is explicit; implementation begins outside this
   skill.

## Guardrails

- **Fixed decisions stand.** When a plan decision proves wrong while pinning
  or writing, stop and report — the user re-decides.
- **The reference is the oracle.** Every specified state names the place in
  the reference that proves it. A state the reference never shows goes to
  the user as a question rather than into the document — the user may answer
  by choosing consistency, and that answer lands as a decision.
- **Closed value sets.** A named set of values is a closed union, extended
  only upon necessity, and named so a usage search returns its real callers.
- **Adoption belongs to the component's own section.** Every listed target
  is a structure this component actually replaces, and adoption runs inside
  that component's step.
- **Shared components stay consumer-agnostic.** Feature knowledge — routes,
  data sources — lives on the feature's side of the contract; the section
  lists the consumption scenarios the component must serve unchanged.
- **Authoring only.** This document is the deliverable; implementation runs
  from it later, elsewhere. Browser access is for pinning values against the
  reference, dispatched through the `web-ui-inspector` agent.
