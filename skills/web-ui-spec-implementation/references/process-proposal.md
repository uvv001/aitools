# Process proposal

The Align-step artifact: the runbook every worker brief quotes. Fill each
section from codebase research — an answer cites the code, config, or CI
definition that proves it. A section research cannot answer goes to the user
as a question, not a guess.

Present the filled proposal and revise until explicitly approved. No worker
dispatches before approval. Fill it once per implementation effort; when a
stage boundary changes a fact, re-present the changed section alone.

## Deployment model

- **Runnable instance** — how one is produced: host process, container
  composition, installer, or a mix, with the commands.
- **Coexistence** — whether multiple instances run at once: port map,
  composition project-name isolation, shared or per-instance database.
- **Collisions and janitors** — what breaks when instances collide, and what
  cleans up after aborted runs.
- **Per-instance registration** — what a fresh instance needs before it
  serves: auth redirects, discovery endpoints, certificates.
- **Local runnability** — yes or no. If no: the remote path that launches it
  (CI job, shared environment) and its feedback latency. This answer caps
  the verification ladder.

## Verification ladder

Derived from the deployment model; highest available rung preferred. One row
per rung — exists, how to run, what it gates:

| Rung | Available | How to run | Gates (proposed) |
|---|---|---|---|
| Unit tests | | | every component |
| Build | | | every component |
| Showcase / visual | | | every component |
| Consumer adoption re-verify | | | adopting components |
| Integration / acceptance / e2e | | | |

A rung reachable only through remote deployment carries its timeline cost
here, with the cadence stated: which rungs gate each component, which gate
the stage close. The proposed column is a starting position; the
cost/coverage trade-off is the user's decision.

## Showcase surface

The surface for the showcase/visual rung. Some UI surface is expected; a
demo application is preferred because it validates each component in
isolation — otherwise a temporary route in the consuming application or
another harness stands in. The specification's named surface is the starting
point; confirm or override it here. Include the verification viewport when
visual comparison applies.

## Isolation level

The chosen level — full worktree + branch + port per worker, or
disjoint-file scoping in a shared checkout — with its cost stated and the
collision surface it answers. This fixes validation ownership: a runnable
per-worker bench puts the whole ladder in the worker; a shared checkout
keeps validation with the orchestrator post-fleet. Include the naming
convention for worktrees, branches, and ports (for example
`<feature>_<component>`).

## Seam validation

Who re-validates merged work at the integration seam — the orchestrator, or
a dedicated validation agent — and which rungs that run covers.

## Stage boundaries

Where the effort stops for approval: the component groups that must finish
before the next group starts, in the specification's order. Step 8 gates at
each one.

## Board location

Where the fleet board for this effort lives.

## Approval

Presented on _date_. Approval is explicit; feedback sends the proposal back
through revision. Implementation starts only after approval.
