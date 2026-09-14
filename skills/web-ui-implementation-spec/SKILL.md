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
   geometry, colors, tokens, content. Dispatch a **fleet** — one
   `web-ui-inspector` agent per component that needs pinning, since one
   component per dispatch keeps a state matrix complete. Drive the live
   reference to each state before measuring. Inspectors are read-only, so
   persisting each report to the working folder as it lands is your job.
   **Ready when:** every state of every component maps to a reference
   location and a pinned value, or carries an explicit no-reference flag.
3. **Frame.** Write §1 and §2 yourself, per
   [references/implementation-spec-format.md](references/implementation-spec-format.md).
   These fix what the fleet cannot negotiate: scope, fixed decisions, the
   implementation order, and the vocabulary ledger — one term per concept,
   with the value sets already in use.
   **Ready when:** §1 and §2 are written, and the ledger names a term for
   every concept the component sections will share.
4. **Draft.** Dispatch a **fleet** of section authors, one component per
   dispatch, each carrying [references/section-brief.md](references/section-brief.md)
   with its slots filled. Dispatch in dependency waves: components that
   consume nothing go first, and a composite waits until the sections it
   quotes have drafted APIs. Each author writes a numbered part file; you
   assemble them in order.
   **Ready when:** every inventory item has a part file whose report names
   its API and its UNVERIFIED list, and the assembled document runs
   frame-then-sections in implementation order.
5. **Unify.** Read the sections as a set: the only pass that catches what
   drafting them separately hides, and the one that repays the fleet's
   risk. Reconcile every term a worker coined against the ledger, turn
   repeated internal structure into a composition proposal, and give a
   concern several components share one treatment.
   **Ready when:** every repetition across sections is extracted, composed,
   or justified in place, and one term survives per concept.
6. **Gate.** Present the whole document for section-by-section review.
   Revise and re-present until the user approves. An edit to approved
   content clears that section's ✅ mark.
   **Ready when:** approval is explicit; implementation begins outside this
   skill.

## Guardrails

- **Hold the index, not the sections.** Workers write part files and return
  a compact report — heading, API, terms coined, what they could not pin.
  Assemble by concatenating files, and read a section back only when Unify
  needs that one. An orchestrator that accumulates every section in context
  runs out of room before the document is finished.
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
