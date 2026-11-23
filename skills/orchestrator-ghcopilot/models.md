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
| **Tier 2:** medium-to-high complexity with a known approach | `mai-code-2` (default for coding). Alternatives: `gemini-4-hydrogen`, `claude-sonnet-5.5`, `gpt-6.1-terra`. |
| **Tier 1:** uncertain approach, interacting constraints, costly failure, or deep review | `gemini-4-carbon`, `gemini-4-neon`, `claude-opus-5.5`, `gpt-6.2-sol`. |

## Review pairing

For `code-review` or Tier 1 review, choose a Tier 1 model different from the
model that authored the change.
