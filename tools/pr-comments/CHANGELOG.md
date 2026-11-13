# Changelog

## 2026-11-12

### Added

- `init` places new databases in `.ai/review-with-docs/` by default. When a new database is in `.ai/review-with-docs/` and Git does not already ignore that folder, `init` appends `/.ai/review-with-docs/` to `.git/info/exclude`. In a Git worktree, `init` writes this rule to the common Git directory.
- `round update` appends a one-line note (such as `"no findings"` or `"no new findings"`) to an opened round.
- `link pending` and the `link` commands reconcile thread replies (`r<id>`), nonempty submitted review bodies (`v<id>`), and edited linked items. `comment_links.seen_digest` stores SHA-256 content digests. Re-running a matching `link` command confirms edited text in place. Unlinking and relinking a newly posted item before `pr sync` preserves its baseline digest.
- `report comments` adds `--ref` and `--pending` filters. Matching threads keep non-matching comments visible as `_(context)_`.
- `src/help-catalog.ts` defines all CLI commands in one TypeScript catalog. This catalog drives CLI `--help` output. `pnpm build` also uses it to update the `README.md` command reference.

### Changed

- SQLite (schema v8) serves as the sole source of truth. The database stores rounds and finding updates in structured columns. The database schema moves from v5 to v8 without cross-version migration. `pr-comments` rejects older databases. Users must recreate older databases with `init`.
- `init` and commands that change review data (rounds and findings) render the `.md` report automatically as a write-only view. If writing the `.md` file fails, `pr-comments` preserves the committed database change and prints a warning. `finding post` extracts comments directly from SQLite.
- `finding post` and `link reply` record returned comment refs locally without re-downloading the pull request. `link reply` also links each posted reply ref as a `note` row.
- The CLI uses a single-pass `parseArgs` validator. Every review command after `init` (other than `help` and `--version`) requires an explicit `.sqlite` `--db` path.
- Mutations on existing databases run in synchronous `BEGIN IMMEDIATE` transactions. `init` creates new database files exclusively (`wx`). Token memoization stores a single `token_source` entry.
- The package requires Node.js `>= 24.15.0`. `pnpm build` writes the standalone bundle directly to `skills/review-with-docs/pr-comments.mjs`.

### Removed

- `pr-comments` removes Markdown report parsing (`src/report-parse.ts`, `src/review-read.ts`), round-trip report assertions, and Markdown heading and code-fence input checks.
- The CLI removes `--json` (and `src/review-evidence.ts`), `init --report`, `report render --out`, `report comments --author`, and `report dump` (`src/review-dump.ts` and Git `textconv` recipes).
- `src/review-files.ts` removes repository-wide database discovery (`src/review-discover.ts`), `.md` path inputs in `reviewPaths`, and temporary `.tmp` file staging on `init`.
