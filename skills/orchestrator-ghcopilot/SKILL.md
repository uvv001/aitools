---
name: orchestrator-ghcopilot
description: Enforces the orchestrator delegation workflow and current subagent model routing for GitHub Copilot CLI.
disable-model-invocation: true
---

# Orchestrator workflow (GitHub Copilot CLI)

Operate this session as an **orchestrator**. Reserve the main context for
planning, decomposition, evaluation, challenging assumptions, and judging
results against acceptance criteria. Delegate execution and verification runs to
subagents so the main context stays clean and compact.

## 1. Load current routing

Read [models.md](models.md) immediately on every invocation of this skill. Treat
it as the single source of truth for unpinned model selection. Re-read both this
file and [models.md](models.md) before dispatching when continuing after
compaction, `/model` change, or `/resume` (or when the user re-invokes
`/orchestrator-ghcopilot`).

## 2. Delegation rules

- **Delegate execution and checks by default.** Send codebase exploration,
  external research, implementation, refactors, builds, test runs, code reviews,
  and visual checks to subagents. Subagents run the checks and return evidence;
  the orchestrator evaluates that evidence against acceptance criteria.
- **Scope direct-work exceptions strictly.** Edit repository files or run checks
  directly only when the user explicitly approves that exact action. Keep direct
  reads to short orientation checks needed to write accurate subagent briefs.
- **Resume delegating after plan mode.** Plan mode restricts subagents to
  read-only tools. As soon as plan mode exits, return to delegating
  implementation and verification runs to subagents.
- **Protect orchestrator context.** Ask subagents for concise, actionable
  reports: decisions, changed file paths, and verification evidence rather than
  raw logs or full file dumps.
- **Parallelize independent work.** Dispatch independent subagents in parallel
  with disjoint file scopes and explicit ownership of git and validation. Queue
  dependent steps.
- **Preserve continuity state.** Record active orchestrator mode, the next
  delegated action, and the author model of in-flight changes in the session
  plan or handoff so recovery after compaction keeps both protocol and pairing.

## 3. Role and model selection

Select an available **role** first, then match **complexity tier and work type** in
[models.md](models.md):

- **Pinned specialist agents:** For specialist roles configured in `/subagents`,
  leave `model` unset so the live CLI pin applies, unless the user requests an
  override. If a specialist role is unavailable in the active session, route the
  work to an available independent agent from [models.md](models.md) or suggest
  the matching slash command to the user.
- **Unpinned tier-routed agents:** For unpinned agents (such as
  `general-purpose` and `code-review`), always set an explicit `model` from
  [models.md](models.md) before dispatch.
- **Current models only:** Select only models listed in [models.md](models.md)
  or pinned by the CLI.

## 4. Review and escalation

- **Independent review:** For non-trivial changes, check the author model before
  dispatching review and select a distinct reviewer model from
  [models.md](models.md). If the author model is unknown, report that reviewer
  independence is unverified.
- **Second opinion:** Use `rubber-duck` when a design choice is costly to
  reverse or evidence conflicts. Provide the decision, the evidence, and the
  assumption to challenge.
- **Tier 1 escalation:** When a simple or Tier 2 attempt misses the quality bar,
  escalate to a Tier 1 model from [models.md](models.md). Pass three items in
  the escalation brief:
  1. The unmet criterion.
  2. The failing test, error, or observed mismatch.
  3. What the prior attempt tried.
  Verify the corrected evidence against the original criterion.

## 5. Completion check

Before reporting a step complete, confirm:
- Execution and verification runs were delegated (any direct action matches an
  explicit user approval for that exact action).
- Every unpinned subagent call specified an explicit model from
  [models.md](models.md).
- For non-trivial changes, the author model, distinct reviewer model, and
  disposition of blocking findings are accounted for (or unverified independence
  is stated explicitly).
- Subagent verification evidence satisfies the acceptance criteria.
