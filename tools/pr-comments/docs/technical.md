# pr-comments: technical notes

This document describes the architecture and design invariants of `pr-comments` for maintainers. For usage instructions and command syntax, see the [README](../README.md).

Contents:

1. [Overview](#1-overview)
2. [The review database](#2-the-review-database)
3. [Ids](#3-ids)
4. [From a finding to a comment](#4-from-a-finding-to-a-comment)
5. [GitHub behaviours learnt from live tests](#5-github-behaviours-learnt-from-live-tests)
6. [Check annotations](#6-check-annotations)
7. [Tokens](#7-tokens)
8. [The report](#8-the-report)
9. [Revisions](#9-revisions)
10. [Build and tests](#10-build-and-tests)
11. [Known limitations](#11-known-limitations)

## 1. Overview

`pr-comments` runs on Node 24.15 or newer. Node executes the TypeScript source files directly through type stripping and uses the built-in `node:sqlite` module. The package has no runtime dependencies. Development dependencies are `typescript`, `vitest`, `rolldown`, and `@types/node`.

The architecture separates pure domain logic from I/O:

- **Pure domain layer**: Review state transitions, link validation, comment extraction, diff-hunk checks, and Markdown rendering operate on in-memory data structures and return new values or throw descriptive errors.
- **Storage layer**: A single SQLite database file is the sole source of truth for a review. The Markdown report next to the database is a write-only view derived from the database after each mutation.
- **GitHub layer**: GraphQL and REST clients download pull request snapshots, publish finding comments, and post duplicate replies using scoped tokens.

## 2. The review database

### 2.1 File lifecycle and storage rules

- One SQLite file holds one complete review: rounds, findings, structured updates, comment links, and the downloaded pull request snapshot.
- The database path must end in `.sqlite`. Every command except `init` requires `--db <file.sqlite>` and opens an existing file without creating side-effect files when the path is missing.
- Only `init` creates a database. When `--db` is omitted, `init` places `<yyyy-mm-dd>_<slug>_review.sqlite` and its companion `.md` report in `.ai/review-with-docs/` at the git root. Whenever the target path is inside `.ai/review-with-docs/` (including subdirectories), `init` checks git ignore rules with `git check-ignore`, adds `/.ai/review-with-docs/` to `.git/info/exclude` if needed (so `.ai/` itself can remain tracked), and aborts if a `.gitignore` rule still exposes the directory.
- `init` refuses existing database or report paths (including symbolic links), opens the database file exclusively (`wx`), and writes the initial state in one transaction. If initialization fails, `init` removes the file.
- Connections use `journal_mode = DELETE` and `foreign_keys = ON`. No `-wal` or `-shm` files are created; a `-journal` file exists only during an active write.
- `PRAGMA user_version` stores the schema version (currently `6`). The tool does not migrate across schema versions; it rejects databases from older or newer schema versions and rejects SQLite files that lack the review tables.

### 2.2 Logical data model

`src/review-store.ts` defines the review and link DDL (`STRICT` tables), and `src/store.ts` defines the pull request snapshot DDL.

**Review tables (`src/review-store.ts`):**

| Table | Purpose |
| --- | --- |
| `review` | Single-row header (`id = 1`) holding the review title (`target`) |
| `intro_items` | Ordered review rounds (`round`, `revision`, nullable `base`, and a JSON array of `notes`) |
| `findings` | Ordered findings (`id` as `F<n>`, `state`, `severity`, `title`, `description`) |
| `updates` | Ordered, structured finding history (`kind`, timestamp `at`, optional `round`, state/severity/title transitions, `revision`, comment `ref`/`reply_ref`, `role`, `action`, `pending`, `pull_request`, `note`) |
| `meta` | Key-value metadata (such as the canonical `pull_request` URL) |

Rounds and finding updates are stored as structured columns in `intro_items` and `updates`, never as pre-rendered Markdown strings. Report rendering and CLI output format the text at render time.

**Pull request snapshot tables (`src/store.ts`):**

| Table | Purpose |
| --- | --- |
| `pr_pull_requests` | Connected pull request metadata, branch refs, `head_sha`, `created_at`, and `fetched_at` |
| `pr_reviews` | Pull request reviews (`COMMENTED`, `PENDING`, etc.), author, state, body, commit, and URL |
| `pr_threads` | Review threads with file path, current and original line ranges, `is_resolved`, and `is_outdated` |
| `pr_comments` | Review comments and issue comments with short `ref`, thread/review IDs, reply target, body, commits, diff hunk, and URL |
| `pr_check_runs` | Head-commit check runs that contain annotations |
| `pr_check_annotations` | Check annotations with computed `ref`, path, line range, level, title, and message |

The database stores at most one pull request snapshot at a time.

**Link tables and relational invariants (`src/review-store.ts`):**

- `linkable` stores every known ref (`r<id>` review comment, `c<id>` conversation comment, or `a<8-hex>` check annotation), its `kind`, and a boolean `gone` flag (`0` or `1`).
- `comment_links` maps each linked `ref` (unique, foreign key to `linkable.ref`) to a `role` (`own`, `duplicate`, or `note`), an optional `finding` (`DEFERRABLE INITIALLY DEFERRED` foreign key to `findings.id`), and an optional `note`.
- Relational invariants enforced by constraints and indexes:
  - A link can reference only a ref present in `linkable`.
  - Each ref can be linked at most once.
  - `own` and `duplicate` links must reference a finding; `note` links must not reference a finding and must include a note text.
  - Each finding can have at most one `own` link (enforced by a partial unique index).
  - Check annotations (`a…`) can only have the `duplicate` role.
  - The foreign key from `comment_links.finding` to `findings.id` is deferred until transaction commit so finding rows can be replaced cleanly inside a write transaction.

### 2.3 Read and write modes

- **Read-only commands** (`finding list`, `finding show`, `link pending`, `pr show`, `report render`, `report comments`, and the offline pre-check phase of `finding post` and `link reply`) open SQLite with `readOnly: true` inside a read transaction. They write zero bytes to the database file and create no lock or journal files.
- **Mutating commands** (`pr connect`, `pr sync`, `round open`, `round update`, `finding add`, `finding set-*`, `finding update`, `finding post`, `link own|duplicate|note|remove`, `link reply`) execute serial write transactions. Dry runs of `finding post` and `link reply` do not open a write transaction.

### 2.4 Serial mutation contract

Every state change runs inside a single synchronous `BEGIN IMMEDIATE` transaction with a 10-second busy timeout:

1. **Acquire write lock**: `BEGIN IMMEDIATE` serializes concurrent writers across processes before reading state.
2. **Validate preconditions**: When a mutation requires a specific pull request, the transaction verifies that the connected pull request matches (case-insensitive host, owner, and repo; exact number). When saving a downloaded snapshot, it verifies that the new `fetchedAt` timestamp is not older than the stored `fetched_at`. When recording newly posted or replied comments, it registers their refs in `linkable` with `gone = 0`.
3. **Transform state**: The current review, links, connected pull request, and active `linkable` refs (`gone = 0`) are loaded and passed to the pure domain operation. Text inputs are validated against control characters, multi-line titles, and multi-word revisions.
4. **Persist changes and commit**: Only modified sections are written back before `COMMIT`. Any error rolls back the entire transaction.

After a review mutation commits (or `init` completes), the tool refreshes the companion `<stem>.md` report file. If writing the report file fails after the database commit, the command keeps exit code `0` and prints a warning on `stderr` explaining how to re-render the report.

### 2.5 Snapshot synchronization and `linkable` reconciliation

`pr sync` downloads reviews, review threads, comments, and head-commit check annotations from GitHub, then updates the database in one `BEGIN IMMEDIATE` transaction:

1. Verifies the connected pull request identity and ensures the downloaded snapshot is not older than the stored snapshot.
2. Replaces all `pr_*` snapshot rows with the freshly downloaded data.
3. Reconciles `linkable`:
   - Every comment and annotation present in the new snapshot is stored in `linkable` with `gone = 0`.
   - Any previous `linkable` row missing from the new snapshot is marked `gone = 1` if a row in `comment_links` still references it; otherwise, it is deleted.

This reconciliation preserves existing links across force-pushes, deleted comments, and new check runs:

- Linked items that disappear from GitHub remain linked (`gone = 1`), stay visible in `finding show`, and do not reappear in `link pending`.
- A `gone` ref cannot receive new links, but `link remove` can unlink it (allowing the next `pr sync` to delete the `linkable` row).
- If a `gone` ref reappears in a later sync, its flag resets to `gone = 0`.
- `pr connect` refuses to switch to a different pull request while any links exist. When no links exist, switching pull requests clears the previous snapshot.

### 2.6 Local ref recording after GitHub writes

When `finding post` or `link reply` creates a comment on GitHub, the new comment ref is not yet in the local pull request snapshot. Instead of re-downloading the pull request after every write:

1. The command loads the review read-only and validates offline preconditions.
2. The publish or reply engine sends the request to GitHub (stopping early on `--dry-run`).
3. On success, a write transaction verifies the connected pull request, inserts or updates the relevant comment refs in `linkable` with `gone = 0` (`finding post` records the own comment ref; `link reply` records both the target duplicate ref and the new reply ref), and saves the link or reply update.

## 3. Ids

| Prefix | Entity | Source |
| --- | --- | --- |
| `F7` | Finding | Next unused integer in the review (never reused; matched case-insensitively) |
| `r544830` | Review comment (inline or file) | GitHub database ID from `#discussion_r544830` |
| `c623843` | Conversation (issue) comment | GitHub database ID from `#issuecomment-623843` |
| `a3f9c2d1e` | Check annotation | Deterministic hash (see below) |

`r…` and `c…` IDs are stable when a pending review is submitted. Because the GitHub web UI cannot search comments by numeric ID, rendered reports format comment IDs as direct links (Section 8).

GitHub does not assign stable IDs to check annotations. `pr-comments` computes each annotation ID as `a` followed by the first 8 lowercase hex digits of the UTF-8 SHA-256 hash of:

```
<app> NUL <path> NUL <start line> NUL <end line> NUL <message>
```

where `<app>` is the check suite's application slug (or lowercase name, or `unknown`), and `NUL` is `\0`:

- An identical annotation on unchanged lines keeps the same ID across commits and check re-runs.
- Moving lines or changing the message produces a new annotation ID.
- Duplicate annotations with the same app, path, line range, and message share one ID.

## 4. From a finding to a comment

`finding post <finding>` builds a comment directly from the database record without reading the rendered `.md` report:

1. **Preconditions**: The review must be connected to a pull request. Findings in any state can be posted; the finding state is omitted from the GitHub comment.
2. **Anchors**: An anchor is a standalone line in the finding description (outside code fences) matching `` `path:start` `` or `` `path:start-end` ``. Paths are normalized to repository-relative forward slashes and rejected if empty, absolute, or containing `..`. Line numbers must be positive with `start <= end`. By default, the first anchor is used; `--anchor <n>` (1-based) selects another.
3. **Comment body**: Formatted as `<severity> **<id> — <title>**`, a blank line, and the finding description (never the Updates section). With `--by-agent`, `🤖 *Written by an AI agent.*` is prepended above a blank line.
4. **Link cleaning**: Relative inline Markdown links (outside code spans and code fences) are replaced with their link text because review-local targets do not resolve on GitHub. Absolute links remain intact. Relative images, reference-style links, and mentions of the report filename or `round-<n>/` paths remain as written and emit warnings.
5. **General comments**: A finding without an anchor becomes a pull request conversation comment and requires `--now`.
6. **File-level findings**: Anchored as `path:1` (an inline comment on line 1). If line 1 is not inside a diff hunk on a modified file, the tool refuses the post and lists the commentable line ranges.
7. **Commit pinning (`--commit <sha>`)**: Accepts 7 to 40 hex digits and resolves the full OID through GitHub GraphQL (`repository.object`). If the resolved commit matches the pull request head, it is treated as unpinned.
8. **Updating an existing own comment**: When a finding already has an `own` link, `finding post` updates that comment on GitHub. Only comments authored by the current token owner can be updated. If the anchor path or line range changed, or if the comment was deleted on GitHub, the tool refuses the update and instructs the user to unlink the old comment with `link remove` before posting again.
9. **Adopting identical comments**: When a finding has no `own` link, the publish engine checks whether an identical comment by the viewer already exists at the same location (after normalizing line breaks and trimming). If found, it adopts and links that comment instead of creating a duplicate.
10. **Outcome recording**: The result action is `created`, `updated`, `unchanged`, or `error`, with state `pending` or `posted`. Non-error runs record the `own` link and append a structured update entry on the finding.

**GitHub API calls used for publishing and replying:**

| Operation | API Call |
| --- | --- |
| Inline or file comment (pending review) | GraphQL `addPullRequestReviewThread` (reuses the viewer's pending review or creates one at the PR head; `subjectType` is `LINE` or `FILE`) |
| Pinned inline comment (`--commit`, no pending review) | GraphQL `addPullRequestReview` with `commitOID` and one initial thread |
| Immediate inline comment (`--now`) | REST `POST /repos/{o}/{r}/pulls/{n}/comments` with `commit_id`, `line`, `side`, and optional `start_line`/`start_side` |
| General conversation comment (`--now`) | GraphQL `addComment` |
| Edit existing comment | GraphQL `updatePullRequestReviewComment` or `updateIssueComment` |
| Reply to a review thread | GraphQL `addPullRequestReviewThreadReply` targeting the viewer's pending review (creates an empty pending review via `addPullRequestReview` first if none exists) |
| Reply to a conversation comment (`--now`) | GraphQL `addComment` |
| Validate anchor against PR diff | REST `GET /repos/{o}/{r}/pulls/{n}/files` (100 per page, up to 30 pages / 3,000 files) |

Before posting an unpinned inline comment, the tool checks the pull request diff: the target file must be present and not removed, must have a text `patch`, and the target line range must fall within a single right-side diff hunk. For a `--commit` pinned comment, only the file path presence in the diff is verified locally.

## 5. GitHub behaviours learnt from live tests

These behaviors were verified against GitHub Enterprise Server 3.19.4 using a classic token:

### Pending reviews

- Each user can have at most one pending review per pull request, visible only to that user's token.
- `addPullRequestReviewThread` automatically creates a pending review at the PR head when none exists, or appends to the existing one.
- While a pending review exists, GitHub rejects single-comment REST publishes (`--now`) and second pending reviews with HTTP 422 / `UNPROCESSABLE`. `pr-comments` detects the existing pending review and refuses `--now` up front.
- Standard review and thread GraphQL queries include the viewer's `PENDING` review; viewer-specific shortcut fields (`viewerLatestReview`) do not.
- Submitting a pending review preserves comment IDs and URLs. Discarding a pending review permanently invalidates its comment URLs.
- Editing a pending comment updates `updatedAt` but leaves `lastEditedAt` null; editing a submitted comment sets `lastEditedAt`.

### Lines, commits, and thread shapes

- `addPullRequestReviewThread` always resolves line numbers against the PR head diff. Pinning a thread to an earlier commit requires creating the pending review via `addPullRequestReview` with `commitOID`; therefore, `--commit` is refused when a pending review already exists.
- GraphQL `commitOID` and REST `commit_id` require full 40-character SHA hashes.
- Multi-line range comments require `startLine < line` within the same diff hunk.
- File-level threads (`subjectType: FILE`) return from GraphQL with thread `line = 1`, comment `line = null`, and `diffHunk = ""`. `pr-comments` identifies file-level threads by the empty `diffHunk`.
- Single-line threads return `startLine = line` on the thread and `startLine = null` on the comment. Outdated range threads set `line` and `startLine` to `null` and keep the range in `originalStartLine` and `originalLine`.

### Silent failures and error classification

- GraphQL `addPullRequestReviewThread` and `addPullRequestReviewThreadReply` can return HTTP 200 with `thread: null` or `comment: null` and no `errors` array when given an invalid anchor or empty body, sometimes leaving an empty pending review behind. `pr-comments` validates the diff before calling GitHub and treats a `null` payload as an error.
- Bundling multiple mutations in a single GraphQL request can yield partial execution alongside HTTP 200 errors; the client sends one mutation per request.
- Access-denied responses (HTTP 401/403, GraphQL `FORBIDDEN`, `Resource not accessible`, or `Could not resolve to a Repository/PullRequest`) trigger fallback to the next configured token (Section 7). Validation errors (`UNPROCESSABLE`, `NOT_FOUND`, REST 404/422) fail immediately without trying another token.

### Replies

- GraphQL `addPullRequestReviewThreadReply` posts immediately if called without a pending review ID, creating a standalone `COMMENTED` review. To prevent accidental immediate comments, `pr-comments` always supplies a pending review ID—creating an empty pending review first if necessary and deleting that empty review if the reply mutation fails.
- Conversation comments (`c…`) have no thread or pending state; replying creates a new conversation comment and requires `--now`.
- GitHub rejects a conversation comment whose entire body is `Duplicate of <url>` without trailing punctuation, so duplicate replies always end with a period (`Duplicate of <url>.`).
- Before posting a duplicate reply, `link reply` verifies that the finding's `own` comment still exists on the pull request and skips posting (`unchanged`) if an identical reply by the viewer is already in the thread.
- The tool never resolves threads or minimizes/edits other users' comments.

## 6. Check annotations

Static analysis tools (such as SonarQube) publish issues as Check Run annotations rather than PR comments.

During `pr sync`, the GraphQL client fetches check annotations for the pull request's head commit (`commits(last: 1)`):

- Queries the latest check runs of every check suite on the head commit (using GitHub's default latest-run behavior rather than `filterBy: ALL` so re-runs are not double-counted).
- Stores only check runs that have at least one annotation, keeping all severity levels (`notice`, `warning`, `failure`).
- Uses bounded page sizes (20 suites/runs, 100 comments/annotations) to stay under GitHub's 500,000-node GraphQL query limit.
- Records the check suite's application slug as the annotation author.
- Fails the entire sync if fetching check runs fails, preserving access-denied errors for token fallback.

`report comments` renders check runs under a `## Checks` section (sorted by check run name) with each annotation's computed `a…` ID, level, file/line location, and message.

## 7. Tokens

Tokens are sent only to the host of the target pull request URL. Each token must be a single line of visible ASCII characters.

### Discovery order

The tool searches token sources from most specific to least specific, preferring environment variables over files within the same scope:

| Scope | Environment variable | File in `~/.config/tokens` (Windows: `%USERPROFILE%\.config\tokens`) |
| --- | --- | --- |
| Host and owner | `PR_COMMENTS_TOKEN_<HOST>__<OWNER>` | `<host>_<owner>` |
| Host | `PR_COMMENTS_TOKEN_<HOST>` | `<host>` |

- Environment variable names convert `<host>` and `<owner>` to uppercase and replace non-alphanumeric characters with `_` (for example, `PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM__ACME`).
- File names replace characters outside `[A-Za-z0-9._-]` with `_` and are matched case-insensitively.
- Duplicate token values across sources are deduplicated before use.

### Fallback and source memoization

When multiple tokens are configured for a host and owner:

1. The token source that succeeded most recently (`token_source` in `~/.cache/pr-comments/token-sources.json`) is tried first.
2. If a token fails with an access-denied error before any data is written (and before creating a temporary pending review in `link reply`), the tool tries the remaining candidate tokens in discovery order. Network, server, and validation errors stop immediately.
3. The working source identifier (such as `file:ghe.example.com` or `env:PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM` — never the secret token itself) is saved as `token_source` in `~/.cache/pr-comments/token-sources.json` (including on `--dry-run`, which verifies write access against GitHub). Cache read or write failures are ignored.

### Token permissions

- **Classic personal access token**: Needs the `repo` scope for private repositories.
- **Fine-grained personal access token**: Must belong to the resource owner (organization or user) that owns the target repository, with **Pull requests: Read** for `pr sync` and **Pull requests: Read and write** for `finding post` and `link reply` (plus **Checks: Read** when required for check annotations).

## 8. The report

### Markdown report (`<stem>.md`)

`report render` (and automatic post-mutation rendering) writes `<stem>.md` next to the SQLite database. The report is strictly write-only: `pr-comments` never parses a Markdown report back into the database, and overwrites the file with LF line endings on every render. It refuses to overwrite a SQLite file.

Report structure:

1. `# Review — <target>`
2. `## Intro`: Contains **Reviewed** with one bullet per round (`Round <n> — `<revision>`, base `<base>`[; <notes>]` or `base none — reviewed as it stands`).
3. `## Dashboard`: Starts with `<!-- generated by pr-comments — do not edit by hand -->` and groups findings by state (`### <marker> <count> <label>`) with numbered heading-slug anchor links.
4. `## Findings`: One `### <state> <severity> <ID> — <title>` section per finding, containing `#### Description` and `#### Updates`.

Each entry under `#### Updates` is formatted at render time from structured database columns as `<yyyy-mm-dd hh:mm> — [Round <n>: ]<event>[ — <note>]` in local time. When an update references a pull request comment (`r…` or `c…`) and the update recorded the pull request URL, the renderer formats the ref as a direct Markdown link (`[r544861](<pr-url>#discussion_r544861)` or `#issuecomment-…`). Check annotations (`a…`) have no individual GitHub URL and render as plain text.

## 9. Revisions

`round open` (`--revision`, `--base`) and `finding set-state` (`--revision`) resolve commit expressions in the working directory's git repository using:

```
git rev-parse --verify --quiet --short=8 <rev>^{commit}
```

with `LC_ALL=C`. The database stores the resolved lowercase short commit hash (at least 8 hex characters, or more when needed to disambiguate). `round open --revision` defaults to `HEAD`, and requires either `--base <rev>` or `--no-base`. In contrast, `finding post --commit` resolves commit hashes remotely via GitHub GraphQL rather than local git (Section 4).

## 10. Build and tests

### Single-file bundle and generated README reference

- `pnpm build` executes `scripts/build.ts`, which uses `rolldown` (`platform: 'node'`) to bundle `src/cli.ts` and all internal modules into a single zero-dependency ES module at `../../skills/review-with-docs/pr-comments.mjs` (or `--out <file>`). Only `node:` built-in imports remain external.
- During a default `pnpm build`, the build script also synchronizes the generated `## Command reference` section in `README.md` (delimited by `<!-- BEGIN GENERATED COMMAND REFERENCE -->` and `<!-- END GENERATED COMMAND REFERENCE -->`) from the CLI help catalog in `src/help-catalog.ts`, writing `README.md` only when the generated section changed.
- The bundle embeds a `__BUILD__` identifier reported by `pr-comments --version` (`pr-comments <version>+<short-sha>[-dirty]`). The `-dirty` suffix checks only tracked files under `tools/pr-comments/`, so rebuilding the output bundle in `skills/review-with-docs/` does not mark the build dirty.
- For global CLI installation from source, `pnpm add -g .` links `./src/cli.ts` directly (Node does not strip types inside packaged `node_modules`).

### Offline test suite

- `pnpm test` runs `vitest run`; `pnpm typecheck` runs `tsc --noEmit`.
- All tests run offline. GitHub GraphQL/REST calls, clock timestamps, working directory, standard input/output, and revision resolution are isolated behind injected fakes or local temporary git repositories.
- Integration tests in `scripts/build.test.ts` compile the single-file bundle and verify that its CLI output, exit codes, database mutations, report rendering, and README command-reference synchronization match the TypeScript sources.

## 11. Known limitations

- **File-wide findings on modified files**: File-level findings anchor at `path:1`. On modified files where line 1 is outside the diff hunks, GitHub rejects line-1 inline comments; the tool lists the commentable ranges so the author can pick one.
- **Fine-grained tokens and check annotations**: Check annotation downloads require Checks read access; if a token lacks permission to read check runs, `pr sync` fails rather than silently skipping checks.
- **Live verification scope**: Live tests were run against GitHub Enterprise Server 3.19.4 with a classic token. Behavior on `github.com`, fine-grained token edge cases, head-branch pushes while a pending review exists, and cross-hunk line ranges were not live-tested.
- **Pending review visibility and edit markers**: Pending reviews are visible only to their author's token, and GitHub does not set `lastEditedAt` when a pending comment is edited before submission.
- **Review verdict bodies**: Top-level review submission bodies have no comment ID (`r…` or `c…`), so they cannot be linked in `comment_links` and do not appear in `link pending` (they remain visible in `report comments`).
- **Head-only check annotations**: Only check annotations on the pull request's current head commit are stored; re-run `pr sync` after new commits.
- **Single-writer binary database**: SQLite databases allow one active writer at a time.
- **No cross-version schema migration**: Databases created by an older schema version (`PRAGMA user_version`) must be recreated with `pr-comments init`.
