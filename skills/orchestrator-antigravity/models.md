# Subagent and swarm model routing

Single source of truth for lane assignment, quota pools, `invoke_subagent`
tiers, and `swarm` model slugs in `orchestrator-antigravity`. Update this file
when Antigravity's model catalog or tier mappings change.

## Preferred orchestrator (primary session)

- Standalone `gemini-4-neon-high` or `gemini-4-neon-xhigh` (select directly via
  `/model`, not the built-in `Orchestrator` preset).

## Quota pools

Antigravity enforces shared 5-hour and weekly limits per pool:

- **Claude pool:** `claude-sonnet-5-5-*`, `claude-opus-5-5-*`
- **Gemini pool:** `gemini-4-neon-*`, `gemini-4-carbon-*`, `gemini-4-hydrogen-*`,
  and the internal `flash_lite` tier

Dispatching standard implementation to Claude first and routing exploration,
mechanical checks, and fallback execution to Gemini spreads load across both
pools.

## `invoke_subagent` tier mappings

`invoke_subagent` accepts only four `Model` enum values (not exact slugs):

| `Model` tier | Verified runtime resolution | Use for |
| --- | --- | --- |
| `flash_lite` | `gemini-3.5-flash-lite` (internal-only) | Trivial mechanical edits, formatting, log extraction, single-symbol lookups (verify output; escalate to `flash` on any slip) |
| `flash` | `gemini-4-hydrogen-tiered-high` | Local `research` (no network access), external read-only web research, browser checks, Executor 2 coding, builds, tests, rapid tool loops |
| `pro` | `gemini-4-hydrogen-tiered-xhigh` | Higher-effort Hydrogen reasoning only — **does not resolve to Neon or Carbon** |
| `inherit` | Primary session model (standalone Neon when following Preferred orchestrator) | Tier 1 Gemini-pool work and Neon reviews when primary is standalone Neon |

## Task-to-lane routing

Choose the tier by uncertainty, risk, and quota pool — not by file count alone.
Follow [swarm-lane.md](swarm-lane.md) for live `swarm` slug and quota checks.

| Tier / Work | Lane | Primary model | Fallback / alternative |
| --- | --- | --- | --- |
| **Local codebase exploration** | `invoke_subagent` (`research`) | `Model: "flash"` | `Model: "flash_lite"` for trivial single-symbol lookups (`research` is sandboxed without network access) |
| **External web research** | `invoke_subagent` (`self`, read-only prompt) | `Model: "flash"` | `Model: "inherit"` (when primary is standalone Neon) or `swarm` `gemini-4-neon-high` for complex synthesis |
| **Browser / visual checks** | `invoke_subagent` (`self`, installed inspector agent, or `define_subagent` with `EnableMCPTools=true, EnableWriteTools=false`) | `Model: "flash"` | `Model: "inherit"` (when primary is standalone Neon) or `swarm` `gemini-4-neon-high` for complex visual/DOM judgment |
| **Simple / mechanical:** obvious edit or check | `invoke_subagent` (`self`) | `Model: "flash_lite"` | Escalate immediately to `Model: "flash"` (Executor 2), or Tier 1 if the task turns non-mechanical |
| **Executor 1 (default coding):** medium-to-high complexity, separate Claude quota | `swarm` | `claude-sonnet-5-5-high` (`claude-sonnet-5-5-medium` for lighter edits) | Pre-flight exhausted -> Executor 2 (`invoke_subagent` `flash`); mid-task exhausted -> hot-swap `swarm{action:"model"}` to `gemini-4-hydrogen-high` |
| **Executor 2 (Gemini quota):** fast coding, rapid tool loops, builds/tests, Claude fallback | `invoke_subagent` (`self`) | `Model: "flash"` | `Model: "pro"` (Hydrogen XHigh) for deeper single-pass reasoning; `swarm` `gemini-4-hydrogen-high` / `gemini-4-hydrogen-xhigh` when coordinating on the board |
| **Tier 1 (default):** uncertain approach, interacting constraints, costly failure, or independent review | `invoke_subagent` (`self`) or `swarm` | `invoke_subagent(Model="inherit")` (when primary is standalone Neon) or `swarm` `gemini-4-neon-high` / `claude-sonnet-5-5-high` | Cross-pool failover between `claude-sonnet-5-5-high` and `gemini-4-neon-high` (`gemini-4-neon-xhigh` within Gemini pool); pick the opposite family from the author for reviews |
| **Tier 1 (heavy escalation):** default Tier 1 fails, or deep security / architecture audit | `swarm` | `claude-opus-5-5-high` or `gemini-4-carbon-high` | Cross-pool failover between `claude-opus-5-5-high` and `gemini-4-carbon-high` |

## Independent review pairing

- **Claude-authored change** (`claude-sonnet-5-5-*` / `claude-opus-5-5-*`):
  review with **Gemini 4 Neon** (`invoke_subagent(Model="inherit")` when primary
  is standalone Neon, or `swarm` `gemini-4-neon-high`) or `gemini-4-carbon-high`
  for deep audits.
- **Gemini-authored change** (`flash_lite` / `flash` / `pro` / `gemini-4-*`):
  review with **Claude Sonnet 5.5** (`swarm` `claude-sonnet-5-5-high`) or
  **Claude Opus 5.5** (`swarm` `claude-opus-5-5-high`) for deep audits.
- **Cross-pool exhaustion fallback:** if the opposite pool has zero quota and no
  AI credits cover it, review with a distinct tier in the available pool (for
  example `gemini-4-neon-high` or `gemini-4-carbon-high` reviewing Hydrogen, or
  `claude-sonnet-5-5-high` reviewing Claude Opus) and state same-family review
  due to quota explicitly (or unverified independence if no distinct tier is
  available).
