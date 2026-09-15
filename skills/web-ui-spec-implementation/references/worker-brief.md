# Worker brief

Dispatch template for building one component. Hand a subagent this brief
with the slots filled; one component per dispatch, because a worker holding
two components validates neither completely. The fleet rules in
[../SKILL.md](../SKILL.md) govern the dispatch; this brief fills the slots
they name.

## Dispatch slots

- **COMPONENT** — name, and its section in the approved specification (path
  plus heading).
- **SCOPE** — the files and directories this worker owns, disjoint from
  every other worker.
- **BENCH** — worktree path, branch, and port per the approved isolation
  level, or "shared checkout, disjoint files" at the light level.
- **LOOP** — the specification's per-component loop rungs bound to this
  component: create and export, unit-test every listed state, show every
  state on the showcase surface, localize per convention, validate
  standalone, adopt in the listed consumers, review against conventions.
- **VALIDATION** — the rungs this worker must exhaust per the approved
  process proposal, capped by its bench; the showcase surface and the
  verification viewport.
- **PERMISSIONS** — side effects, stated explicitly: commit/stage (default:
  the orchestrator owns git; the worker commits only when this slot says
  so), long-running servers on the assigned port.
- **CONVENTIONS FILE** — path only; the worker reads it. Project conventions
  outrank worker habits.
- **KNOWN FACTS** — pre-seeded research: pinned values, the vocabulary
  ledger's terms, dependency APIs, prior defect lists for this component.

## Worker contract

1. Build the component per its section, and export it from the library's
   public API.
2. Run the LOOP rungs in order; every state the section lists has a test and
   a place on the showcase surface.
3. Exhaust the VALIDATION rungs the BENCH permits. Report complete only
   when every available method has run and passed.
4. Fixed decisions stand: a section detail that proves wrong stops the work
   and is reported as a spec defect for design to re-decide.
5. Use the specification's term for every concept it names; a coined
   synonym is a defect to report, not a choice to ship.

**Done when:** every VALIDATION rung the bench permits has run green, and
the report carries evidence from the highest rung reached.

## Report

Under 200 words: states implemented, validation rungs run with results and
evidence links (test output, server URL, screenshots), defects found and
fixed, spec defects surfaced, blockers. The work stays on the worker's
bench — report the index, not the content, so the orchestrator's context
holds the board instead of the code.

## Guardrails

- One component, one brief. Neighbouring work belongs to its own dispatch.
- Escalate, don't improvise: blocked work returns as a structured blocker —
  what is needed, which files, the suggested fix — not a quiet scope
  expansion.
- Parked, not guessed: a dead reference or unavailable environment returns
  the work as PARKED with the blocker named.
- At per-worker isolation the worker's ladder run is authoritative for its
  scope; in a shared checkout the orchestrator's post-fleet diagnostics are.
  Integration validation happens at the seam after merge, outside this
  dispatch.
