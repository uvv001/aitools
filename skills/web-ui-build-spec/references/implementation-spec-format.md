# Implementation specification format

One markdown file in `docs/` at the project root, named for the feature and
dated from the clock at creation
(`yyyy-mm-dd-<feature>-implementation-specification.md`), beside the approved
plan it implements. The section order is deliberate: the opening sections fix
the contract's frame before any component is specified.

Every section below describes content to write. The specification is
addressed to the implementing agent; this file is addressed to you, writing
it — the loop in §2 is the implementer's, not yours.

## Conventions

- A section the user approves carries ✅ in its heading. When approved
  content changes, the mark comes off until re-approved.
- One term per concept, and one treatment per shared concern, across the
  whole document. When two terms collide, unify them and record the choice.
- Values are pinned: named tokens and closed value sets, each verified
  against the reference. Where the plan reported variants, the specification
  resolves them.

## 1. Intro

- **Purpose** — one line: written for an implementing agent; each section
  contains everything needed to build one component without re-reading the
  research.
- **Sources table** — every input with its role: the approved plan flagged
  "do not reopen decided questions", the project conventions file, the live
  reference, the static captures, any reference implementation.
- **Scope** — in and out. Items dropped mid-work stay listed as out of scope
  so the document keeps the boundary.
- **Fixed decisions** — the plan's decided questions, restated as "do not
  change".
- **Component order** — the inventory as a numbered table, simplest to most
  complex; each step's output is consumed by later steps.

## 2. Implementation process

The loop the implementing agent runs for each component, each rung carrying
the demand that makes it checkable:

- **Create** it per its section, and **export** it from the library's public
  surface.
- **Unit-test** it: every state the section lists has a test, and the
  assertions cover the accessibility contract — roles, ARIA names and states
  — rather than implementation details.
- **Demo** it on the project's showcase surface: every state shown, with
  self-contained mock data. Where the project has no showcase application,
  §2 names the surface that stands in — a route in the consuming app, a
  story, a harness — because every state needs somewhere a human can look at
  it.
- **Localize** library-owned strings per project convention; consumer content
  stays input-driven.
- **Validate standalone**: build, test, run the showcase surface, and compare
  every state against the section's reference locations at the verification
  viewport. A state whose reference cannot be found means the component is
  not done — surface it rather than shipping an unverifiable visual.
- **Adopt in consumers**: replace the structures the section lists and
  re-verify the affected screens before the step closes.
- **Review** it against the project conventions file.

Then the hard rules governing every step:

- Fixed decisions stand. A spec detail that proves wrong stops the step and
  is reported.
- Each concept keeps the one name this document gave it, and each named
  value set stays a closed union, extended only upon necessity.
- Name the showcase surface and the verification viewport; every visual
  comparison uses both.
- Unrelated existing code stays untouched — and adopting a step's own change
  in every consumer is part of that step.

## Component sections (3 onward)

One section per inventory item, in implementation order. Each opens with its
**reference locations**: the exact places in the live reference and captures
to validate each state against. Then:

- **API** — the typed signature; every named value set is a closed union with
  its values enumerated; defaults stated.
- **Rendering and accessibility** — structure, roles, ARIA names and states,
  keyboard behavior.
- **Tokens** — a table mapping each visual value to its design token, every
  value verified against the reference, with measured values recorded where
  the reference defines them.
- **Tests** — one per listed state, plus the accessibility contract.
- **Showcase** — where this component's states are shown, with every state
  present.
- **Consumer adoption** — exactly which existing structures this component
  replaces in this step.

### Mechanism-open components

Where the plan deliberately left the mechanism to a spike during
implementation, the section specifies **requirements and consumption
scenarios, not an API**: the implementation-agnostic contract, the
accessibility hard requirements, every known consumption scenario that must
work without component changes, and the explored option space recorded as
context, not mandates.

### Final assembly

The closing section composes the earlier components into the feature. When
the assembly is large, split it into staged slices — by entity or screen —
each with its own approval.
