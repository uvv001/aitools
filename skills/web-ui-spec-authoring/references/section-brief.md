# Section brief

Dispatch template for drafting one component section. Hand a subagent this
brief with the slots filled; one component per dispatch, because a worker
holding two components writes neither contract completely.

## Dispatch slots

- **COMPONENT** — the inventory entry: name, kind (new / extension / reuse),
  and its number in the implementation order.
- **PLAN EXTRACT** — that component's entry in the approved plan, plus every
  fixed decision naming it.
- **PINNED VALUES** — the measured values and reference locations from the
  pinning pass, per state.
- **VOCABULARY LEDGER** — the terms this document has already fixed, and the
  closed value sets already in use.
- **DEPENDENCIES** — the drafted API of every component this one consumes.
- **FORMAT** — path to the component-section shape in
  [specification-format.md](specification-format.md).
- **CONVENTIONS FILE** — path only; the worker reads it.
- **PART FILE** — the destination, numbered for its place in the order
  (`NN-<component>.md`), so assembly is concatenation.

## Worker contract

1. Write the section into the part file in the shape the format prescribes:
   reference locations, API, rendering and accessibility, tokens, tests,
   showcase, consumer adoption.
2. Every state the section names carries the reference location that proves
   it and the value measured there. A state with neither goes on the
   UNVERIFIED list instead of into the section.
3. Use the ledger's term for every concept it already names. A concept the
   ledger lacks earns a new term, reported as coined.
4. Give every value set a name and a closed union with its values
   enumerated.
5. Quote a dependency's API as the DEPENDENCIES slot states it.

**Done when:** the part file holds the section, and every state it names is
backed by a reference location and a pinned value or sits on the UNVERIFIED
list.

## Report

Under 200 words: the heading written, the API signature, terms coined, value
sets introduced, the UNVERIFIED list, and any plan detail that proved wrong.
The section stays in the part file — summarize it rather than repeating it,
so the orchestrator's context holds the index instead of the document.

## Guardrails

- Fixed decisions stand. A plan detail that proves wrong stops the dispatch
  and is reported.
- Specify what the reference shows. A state it never demonstrates is
  UNVERIFIED; inventing one ships a visual nobody can verify.
- Write the assigned part file alone. A neighbouring section belongs to its
  own dispatch, and the vocabulary it needs travels through the ledger.
- A mechanism the plan left open stays open: specify requirements and
  consumption scenarios in place of an API, and record the explored options
  as context rather than mandates.
