---
name: orchestrator-antigravity
description: Enforces the hybrid invoke_subagent + swarm orchestrator workflow and quota-aware model routing for Antigravity.
disable-model-invocation: true
---

# Orchestrator workflow (Antigravity)

Operate this session as an **orchestrator**. Reserve the main context for
planning, decomposition, evaluation, challenging assumptions, and judging
results against acceptance criteria. Delegate exploration, implementation,
verification, and review to subagents and swarm workers so the main context
stays clean and compact.

## 1. Load current routing and verify mode

Read [models.md](models.md) immediately on every invocation of this skill. Treat
it as the single source of truth for lane selection, tier mappings, and model
routing. Re-read both this file and [models.md](models.md) (plus
[swarm-lane.md](swarm-lane.md) if a swarm is active or planned) before
dispatching when continuing after `/compact`, `/model` change, or `/resume` (or
when the user re-invokes `/orchestrator-antigravity`).

Confirm the primary session runs a standalone model from [models.md](models.md)
rather than Antigravity's built-in `Orchestrator` plan/execute preset. If
built-in `Orchestrator` is active, warn the user once — it lacks mid-run quota
failover and couples `Model="inherit"` to its executor — and recommend switching
`/model` to the preferred standalone orchestrator model.

## 2. Delegation rules

- **Delegate execution and checks by default.** Send codebase exploration,
  external web research, implementation, refactors, builds, test runs, code
  reviews, and browser/visual checks to delegated workers. Workers execute and
  return evidence; the orchestrator evaluates that evidence against acceptance
  criteria.
- **Scope direct-work exceptions strictly.** Edit repository files or run checks
  directly only when the user explicitly approves that exact action. Keep direct
  reads to brief orientation checks needed to write accurate worker briefs.
- **Resume delegating after plan mode.** Plan mode blocks edits. As soon as plan
  mode exits, return to delegating implementation and verification runs.
- **Protect orchestrator context.** Ask workers for concise, actionable reports:
  decisions, changed file paths, and verification evidence rather than raw logs
  or full file dumps.
- **Parallelize independent work safely.** Dispatch independent workers in
  parallel with disjoint file scopes, isolated workspaces (`share` or `branch`
  for concurrent editors), and explicit ownership of git and validation. Queue
  dependent steps.
- **Preserve continuity state.** Record active orchestrator mode, active lane or
  swarm roster, the author model of in-flight changes, any quota fallbacks, and
  the next delegated action in working notes or handoffs so recovery after
  compaction keeps protocol and review pairing intact.

## 3. Lane, role, and model selection

Select the **task tier** from [models.md](models.md) first, then dispatch on its
assigned **lane**:

- **`invoke_subagent` lane (default stable lane):** Use for local read-only
  exploration (`TypeName="research"`), external web research (`TypeName="self"`,
  instructed read-only), browser/visual checks (`TypeName="self"` or an
  installed inspector agent), trivial mechanical work, Gemini-quota coding and
  verification (`TypeName="self"`), and Neon-tier work via `Model="inherit"`
  when the primary session is standalone Neon. Always pass an explicit `Model`
  tier from [models.md](models.md) (check `invoke_subagent` tier mappings
  there before assuming a tier's underlying model). Kill finished subagents
  via `manage_subagents` after landing any `share`/`branch` changes.
- **`swarm` lane (exact-model and cross-quota lane):** This skill explicitly
  instructs you to call the `swarm` tool whenever a task routes to the `swarm`
  lane in [models.md](models.md) (separate Claude-quota execution, cross-family
  review, or Tier 1 heavy escalation). Before your first `swarm` call in a
  session, read [swarm-lane.md](swarm-lane.md) and follow its quota pre-check,
  lean-roster, board-handoff, hot-swap failover, and workspace-landing rules.
- **Current models only:** Dispatch only models listed in [models.md](models.md)
  (verified live on the `swarm` lane per [swarm-lane.md](swarm-lane.md)).

## 4. Review, escalation, and quota failover

- **Independent cross-family review:** For non-trivial changes, check the author
  model before dispatching review and select a distinct reviewer model from
  [models.md](models.md) (preferring the opposite model family). If the author
  model is unknown, report that reviewer independence is unverified; if the
  opposite quota pool is exhausted, fall back per [models.md](models.md) and
  disclose same-family review explicitly.
- **Second opinion:** When a design choice is costly to reverse or evidence
  conflicts, define an isolated read-only challenger with
  `define_subagent(EnableWriteTools=false)` and dispatch it via
  `invoke_subagent` (using a Tier 1 or `flash` model from [models.md](models.md)),
  or use a read-only `swarm` worker on the opposite model family. Pass the
  decision, the evidence, and the assumption to challenge.
- **Escalation:** When a **simple** attempt misses the bar, escalate to
  Executor 2 (`flash`) or Tier 1; when a **standard-executor** attempt misses
  the quality bar, escalate to a **Tier 1** model from [models.md](models.md).
  Pass three items in the escalation brief:
  1. The unmet criterion.
  2. The failing test, error, or observed mismatch.
  3. What the prior attempt tried.
  Verify the corrected evidence against the original criterion.
- **Quota failover:** Run the live quota pre-check in [swarm-lane.md](swarm-lane.md)
  before dispatching any worker on `swarm`. If the target pool is exhausted
  before start, route immediately to the fallback lane or model in
  [models.md](models.md). If a `swarm` worker hits quota mid-task, hot-swap its
  model per [swarm-lane.md](swarm-lane.md) rather than abandoning its context,
  and note the switch in your report.

## 5. Completion check

Before reporting a step complete, confirm:
- Execution and verification runs were delegated (any direct action matches an
  explicit user approval for that exact action).
- Every `invoke_subagent` call passed an explicit `Model` tier from
  [models.md](models.md), every `swarm` dispatch pinned an explicit model from
  [models.md](models.md), and any quota fallback (including pre-flight rerouting
  away from `swarm`) is disclosed.
- For non-trivial changes, the author model, distinct reviewer model, and
  disposition of blocking findings are accounted for (or unverified /
  same-family quota fallback is stated explicitly).
- Every `share`/`branch` workspace edit was landed before killing its subagent
  or `swarm` worker.
- Worker verification evidence satisfies the acceptance criteria.
