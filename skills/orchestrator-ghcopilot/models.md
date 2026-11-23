# Subagent model routing

Single source of truth for unpinned model-to-task assignments in
`orchestrator-ghcopilot`. Update this file when model tiers change.

## Preferred orchestrator

- `gemini-4-neon` (reference for starting or switching the primary session)

## Pinned specialist roles

Specialist agents (`explore`, `task`, `rubber-duck`, `research`,
`web-ui-inspector`) take their active models from the CLI's live `/subagents`
pins. Leave `model` unset when dispatching them so CLI configuration remains the
single source of truth.

## Unpinned task tiers

Pass `model` explicitly on unpinned calls (such as `general-purpose` and
`code-review`). Choose the tier by uncertainty and risk, not by file count
alone.

| Tier / Work | Preferred model |
| --- | --- |
| **Simple:** mechanical change with an obvious check | `mai-code-2-flash` |
| **Tier 2:** medium-to-high complexity with a known approach | `mai-code-2` (default for coding). Alternatives: `gpt-6.1-terra` (low-step refactors), `gemini-4-hydrogen` (rapid tool loops). |
| **Tier 1 (default):** uncertain approach, interacting constraints, costly failure, or independent review | `gpt-6.2-sol` or `gemini-4-neon` (flat 1M context, no 272K price cliff). |
| **Tier 1 (heavy escalation):** only when default Tier 1 fails, or for deep security and architecture audits | `claude-opus-5.5` or `gemini-4-carbon`. |

## Review pairing

For `code-review` or Tier 1 review, choose a default Tier 1 model
(`gpt-6.2-sol` or `gemini-4-neon`) different from the model that authored the
change. Reserve heavy-escalation models (`claude-opus-5.5`, `gemini-4-carbon`)
for deep security/architecture audits or when default Tier 1 is insufficient.
