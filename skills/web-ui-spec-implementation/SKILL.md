---
name: web-ui-spec-implementation
description: Builds the components of an approved UI specification with a fleet of isolated workers, gated one component at a time. Trigger when an approved specification's components must be built, or when a paused implementation stage resumes.
---

# Web UI specification implementation

Turn an approved specification into built, approved, integrated components
without the orchestrator holding every component's work in context. The
specification's own per-component loop is the worker's loop; this skill is
everything around it — alignment, planning, isolation, waves, the board,
gates, integration.

The specification is fixed: a detail that proves wrong stops the component
and returns to the design stage (`web-ui-spec-authoring`), which owns the
decision. Implementation reports; it does not re-decide.

## Inputs

Collect before Align; ask where any is missing.

- **Approved specification** — component order for the dependency graph, the
  per-component loop the workers run, per-component sections with their
  approval marks.
- **Project conventions file** — the rules workers must satisfy; project
  conventions outrank worker habits.
- **The repository** — Align researches it; every claim in the process
  proposal traces to code, config, or CI definition found there.

## Protocol

0. **Align.** Research the codebase and establish three project facts with
   the user, in causal order — deployment caps verification, and both cap
   isolation. Fill
   [references/process-proposal.md](references/process-proposal.md) and
   present it; revise and re-present until explicitly approved. No worker
   dispatches before that approval exists.
   a. **Deployment model** — how a runnable instance is produced (host
      process, container composition, installer, or a mix); whether
      instances coexist (ports, composition project-name isolation, shared
      or per-instance database); what collides when they do, and the janitor
      for each collision; what each instance needs registered up front (auth
      redirects, discovery endpoints). Answer the capping question: is the
      project runnable locally at all? If not, name the remote path that
      launches it (CI job, shared environment).
   b. **Verification ladder** — derived from the deployment model:
      unit tests → build → showcase/visual check → consumer adoption
      re-verify → integration/acceptance/e2e against a live system. Prefer
      the highest available rung. Price remote-only rungs as timeline cost
      and state their cadence (for example: local rungs gate each component,
      remote e2e gates the stage close). Name the showcase surface: some UI
      surface is expected — a demo application validates components in
      isolation and is preferred; a temporary route in the consuming
      application or another harness stands in. The specification's named
      surface is the starting point, not a mandate.
   c. **Isolation level** — full worktree + branch + port per worker, down
      to disjoint-file scoping in a shared checkout; chosen per stage size
      and the deployment model's collision surface, cost stated. The level
      fixes validation ownership (fleet rule 2).
   **Resuming** — an effort that already has a board and an approved
   proposal is aligned: read both, reconcile the board against the
   repository, and continue at step 1 with the next wave. Re-open Align
   where the repository contradicts a fact the proposal records.
   **Ready when:** an approved process proposal is in hand — freshly
   approved or read from the record — and it records the deployment facts,
   the verification ladder with its gating rungs, the showcase surface, the
   isolation level, the seam validator, the stage boundaries, and the board
   location.
1. **Plan.** Turn the specification's component order into a dependency
   graph. A component is dispatchable when every component it consumes is
   approved.
   **Ready when:** the graph names each wave's members, and every member of
   the current wave has its dependencies approved.
2. **Isolate.** Give each worker its bench per the approved level —
   worktree, branch, and port, or a named disjoint file scope — and record
   it on the board per
   [references/fleet-board.md](references/fleet-board.md) before dispatch.
   **Ready when:** no two `planned` workers share a file — nor a port or
   branch at worktree isolation — and every worker's bench is on the
   board.
3. **Brief.** Author each worker's contract from
   [references/worker-brief.md](references/worker-brief.md): one component,
   its specification section and loop, side-effect permissions, the
   validation rungs it must exhaust, the conventions file, pre-seeded known
   facts.
   **Ready when:** each brief binds exactly one component and quotes the
   rungs the process proposal assigned to it.
4. **Dispatch in waves.** Leaves first; composites once their dependencies
   are approved. A worker blocked mid-flight — a dead live reference, a
   missing permission — is parked with the reason named: parked is a board
   state, not a silent stall.
   **Ready when:** every dispatched worker has a board row, and every
   non-dispatchable component names what it waits on.
5. **Track.** The board is written at four moments: a bench assigned (2),
   a worker dispatched (4), a gate outcome (6), and integration (7). Each
   lands the same turn its event happens, as theses linked to artifacts.
   The board is the machine state; the session's progress record stays the
   narrative and links it.
   **Ready when:** the board answers, for every component — state, where the
   work lives, which session ran it — and no event from steps 2, 4, 6, or 7
   is missing its entry.
6. **Gate per component.** A worker reports complete only after exhausting
   every validation rung its bench permits; validation is where visual
   defects die, not review. Then present the component, collect the defect
   list, fix, re-present. Approval is explicit and per component; an edit to
   approved work sends it back to review.
   **A spec defect** — a section detail the build proves wrong — takes the
   other path: park the component, put the defect to the user as a design
   question, carry the decision back into the specification, and re-brief
   from the corrected section. That corrected section is the route back
   into the build.
   **Ready when:** the component's row shows ✅ and the presentation carried
   evidence from the highest rung available to that worker.
7. **Integrate.** Merge approved work into the feature branch per project
   convention, then re-validate the merged result at the seam, run by
   whoever the proposal names. At stage close, prepare the PR description.
   **Ready when:** the feature branch contains the approved commits and the
   seam run covered the rungs the proposal assigned it.
8. **Stage gate.** At each boundary the proposal records, run the rungs it
   assigned to the stage close — the remote ones whose timeline cost was
   priced in Align — then present the stage and stop until the user
   continues.
   **Ready when:** every stage-close rung has run with its evidence
   attached, and the user approved the stage — or explicitly waived the
   stop — before the next stage's Plan begins.

## Fleet rules

Each rule names its actor. The orchestrator obeys its own and verifies the
worker's at the gate; a worker-acted rule travels inline with the dispatch,
since a subagent holds the brief rather than this file.

1. **Bounded disjoint scopes** *(orchestrator)* — one unit of work per
   agent, and exactly one owning agent per file.
2. **Validation follows isolation** *(orchestrator decides, worker
   executes)* — the brief states side-effect
   permissions explicitly (default: the orchestrator owns git). A worker
   with a runnable bench runs the full approved ladder itself, unit tests
   up to the highest available rung, and reports complete only when every
   available method is exhausted. The orchestrator validates at integration,
   or escalates a hard case to a more capable validation agent — delegation
   raises the probability of success, and keeping validation context out of
   the orchestrator shortens the loop to one hop.
3. **Structured results** *(worker; verified at the gate)* — status plus
   machine-readable notes naming the blocker, needed files, and the
   suggested fix.
4. **Escalate, don't improvise** *(worker raises, orchestrator
   re-dispatches)* — blocked single-scope work becomes a wider-scope
   follow-up agent, not a quiet scope expansion.
5. **Pre-seed known facts** *(orchestrator)* — prior research goes into
   briefs to prevent divergent guesses.
6. **Shared checkouts validate post-fleet** *(orchestrator)* — broken
   intermediate builds are
   expected while a fleet runs against shared files; post-fleet diagnostics
   are the authoritative missed-work list. With per-worker isolation the
   worker's own ladder run is authoritative for its scope, and post-fleet
   diagnostics cover only the integration seam.
7. **Slice-wise consumption** *(orchestrator)* — fleet output is isolated,
   verified, committed, and reviewed one component at a time.

## Guardrails

- **Hold the board, not the components.** The orchestrator plans, briefs,
  tracks, gates, integrates — and delegates the hard component too. An
  orchestrator that absorbs a component's work runs out of context before
  the stage is finished; that is the failure the fleet exists to prevent.
- **Fixed decisions stand.** A specification detail that proves wrong stops
  the component and is reported back to design. Implementation is where
  specification naming gets tested — a wrong name returns as a spec defect
  and gets locked once decided.
- **One name per concept.** Workers use the specification's vocabulary; a
  coined synonym is a defect to unify, not a style choice.
- **Stale artifacts first.** Rebuild in dependency order before reporting a
  showcase fault; an unresolved file is a build-order fault until proven
  otherwise.
- **Parked, not guessed.** A dead live reference or an unavailable
  environment parks the affected visual work with the blocker named; the
  board shows it, and the work resumes when the reference is back.
- **Project conventions outrank worker habits.** Workers read the
  conventions file and satisfy it; defensive code the project rejects is a
  defect at the gate.
- **The board and the progress record stay separate.** Board = per-feature
  machine state; the session's progress record = the narrative. The record
  links the board and logs dispatch and report receipt separately.
