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
| **Simple:** mechanical code or text change with an obvious check (format conversions, targeted single-line patches) | `mai-code-2-flash` |
| **Tier 2 (code):** medium-to-high complexity code change with a known approach | `mai-code-2` (default for code). Alternatives: `gpt-6.1-terra` (low-step refactors), `gemini-4-hydrogen` (rapid tool loops). |
| **Tier 2 (prose & documents):** specifications, reports, reviews, Jira/PR descriptions, skills, and documentation | `gemini-4-hydrogen` (default for prose; reserve `mai-code-2` for code). |
| **Tier 1 (default):** uncertain approach, interacting constraints, costly failure, or independent review | `gpt-6.2-sol` or `gemini-4-neon` (flat 1M context, no 272K price cliff). |
| **Tier 1 (heavy escalation):** only when default Tier 1 fails, or for deep security and architecture audits | `gpt-6.2-astra` or `gemini-4-carbon`. |

## Review pairing

For `code-review` or Tier 1 review, choose a default Tier 1 model
(`gpt-6.2-sol` or `gemini-4-neon`) different from the model that authored the
change. When `gemini-4-hydrogen` authors a document, prefer `gpt-6.2-sol` for
independent review so the reviewer comes from a different model family. Reserve
heavy-escalation models (`gpt-6.2-astra`, `gemini-4-carbon`) for deep
security/architecture audits or when default Tier 1 is insufficient.
