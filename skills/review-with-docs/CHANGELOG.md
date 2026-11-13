# Changelog

## 2026-11-12

### Added

- Reviews use `<session-folder>/files/review-with-docs/` when the host provides a session folder. Without a session folder, reviews use `.ai/review-with-docs/`. This default keeps review artifacts out of Git commit history. Later sessions can continue a review from the review folder, `.ai/review-with-docs/`, or a named session folder.
- Fleet dispatches select an explicit `model` in two tiers: deep-reasoning models and fast, precise models. Under the **tier bound**, each tier with two or more agents uses at least two model families when available. When the orchestrator wrote the fixes, `recheck` runs on a different model family.
- Round 2 and later rounds run in two ordered phases: verification (`recheck`) first, then discovery. With more than 15 findings in re-check scope, the orchestrator splits verification across parallel `recheck-1`, `recheck-2`, … shards. The orchestrator records all verification outcomes in SQLite before it dispatches discovery agents.
- Fleet recording dispatches a deduplication pass when a round has more than 10 candidate findings or more than 30 existing findings. The orchestrator shards deduplication when a round has more than 20 candidates or when `candidates × existing findings > 500`. This pass merges same-defect candidates into `merged/<slug>.md`. It also preserves `PR-comment` `<item-ref>` to `<F>` mappings.
- Step 4 and step 7 add a three-way **closed-finding gate** (`Drop`, `Reopen <F>`, or `New finding`) for closed findings (❌, 📌, 🔀). Agents read `Updates` with `finding show <F>`. Before agents reopen `<F>`, they check for code changes in the finding's causal path or concrete proof that refutes a factual premise in the discard note. Agents file a new finding only for a distinct defect.

### Changed

- `SKILL.md` and `fleet.md` define the `.md` report as a write-only view for user reading and post-session search. During an active review, agents read and update state only through `pr-comments` commands on `--db <file.sqlite>`. The orchestrator runs all state-changing commands one at a time.
- `pull-request.md` extends PR reconciliation to cover thread replies (`r<id>`), nonempty submitted review bodies (`v<id>`), and edited linked items (`edited`). `pull-request.md` adds numeric sharding thresholds for parallel `PR-comment` agents: more than 10 pending items, more than 30 existing findings, or `pending items × existing findings > 150`.
- The bundled `pr-comments.mjs` requires Node.js `>= 24.15.0` and SQLite schema v8. Schema v8 rejects databases from earlier schema versions without migration. Review continuation applies only to schema-v8 databases. `.gitattributes` marks `pr-comments.mjs` as `linguist-generated`.

### Removed

- `SKILL.md` removes the `Checkpoint` step that committed review artifacts to Git history. `pr-comments.mjs` removes `report dump` and Git `textconv` workflows.
- `pull-request.md` and `pr-comments.mjs` remove `--json` on `pr show` and `--author` on `report comments`.
