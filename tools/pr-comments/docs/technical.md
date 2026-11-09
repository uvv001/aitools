# pr-comments: technical notes

These notes are for people who change the tool. How to use it is in the [README](../README.md).

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

Node 24.15, TypeScript run directly by Node (type stripping), the built-in `node:sqlite`. No runtime dependencies. The only dev dependencies are `typescript`, `vitest`, `rolldown` and `@types/node`.

| Area | Files |
| --- | --- |
| Command line | `src/cli.ts`: one table of commands, strict arguments, the help texts, one function per command |
| Review database | `review-store.ts` (schema, open modes, `inTransaction`), `store.ts` (the pull request snapshot, `linkable`), `review-files.ts` (init, render, sync, `requireConnectedReview`, `changeReviewState`, `recordAfterWrite`), `review-naming.ts`, `review-dump.ts` |
| Review model | `review-model.ts`, `review-ops.ts` (pure changes of a review), `review-links.ts` (rules of the links), `review-view.ts` (list and show), `review-pending.ts` (the list of `link pending`) |
| Report | `review-render.ts` (writes it), `report-dashboard.ts` |
| GitHub | `github.ts` (GraphQL reads, check runs), `rest.ts`, `github-write.ts` (shared write queries, mutations, and helpers), `publish.ts` (comment engine), `reply.ts` (reply engine), `review-post.ts` and `review-reply.ts` (glue between the engines and the database), `download.ts`, `token.ts`, `token-memo.ts` |
| Pull request as markdown | `markdown.ts` (`report comments`) |
| Comment building | `report-extract.ts` (finding to comment), `comment-ref.ts`, `diff.ts` |
| Git | `git-revision.ts` |

Every module that changes a review is pure: it takes the review (and links) and returns a new one, or throws an `Error` whose message says what to do. Only `review-files.ts` (with `review-store.ts` and `store.ts` under it) writes these changes to the database.

## 2. The review database

### 2.1 The file

- One SQLite file holds one review: the findings, the rounds, the links, and the downloaded pull request.
- Its name ends in `.sqlite`. The default on `init` (when `--db` is not given) is `<yyyy-mm-dd>_<slug>_review.sqlite` in `.ai/review-with-docs/` at the git root, next to the report `….md`; whenever `init` places a review under `.ai/review-with-docs/` (subfolders included), it checks the target paths with `git check-ignore`, adds `/.ai/review-with-docs/` to `.git/info/exclude` when not already ignored (while `.ai/` itself can be versioned), and fails if a `.gitignore` rule still exposes the folder. `--db <file.sqlite>` is required on every command except `init`, and must end in `.sqlite`.
- Only `init` creates it. It refuses an existing database or report path (symbolic links included) before creating anything, opens the new file exclusively (`wx`), and writes the initial review and connected pull request in one transaction (removing the file if seeding fails).
- Every other command opens an existing file. A missing file is `<path> does not exist`. Nothing is created as a side effect.
- The file uses a rollback journal (`journal_mode = DELETE`). There is no `-wal` or `-shm` file. A `-journal` file exists only while a command writes.
- `foreign_keys = ON` on every connection. The review tables are `STRICT`.
- `PRAGMA user_version` holds the schema version, now 6 (`REVIEW_SCHEMA_VERSION`). There is no cross-version migration (within schema 6, `savePullRequest` adds `pr_threads.original_start_line` if absent). An older database (version 5 included) is refused with `<path> was written by an older pr-comments (schema <n>); start again with "pr-comments init"`. A newer one is refused with `… was written by a newer pr-comments (schema <n>); update the tool`. A SQLite file without the review tables is `<path> is not a review database`.
- Meta keys: `pull_request` (the connected pull request, canonical URL).

### 2.2 Tables

The review half:

| Table | Content |
| --- | --- |
| `review` | One row (`id = 1`): `target` (the title) |
| `intro_items` | The items of **Reviewed** in `position` order: `round`, `revision`, `base` (`NULL` for `--no-base`), and `notes` (a JSON array of strings when notes are present) |
| `findings` | `position`, `id` (`F<n>`, unique), `state` and `severity` (the markers), `title`, `description` |
| `updates` | `finding`, `position`, `kind`, `at`, `round`, and the structured event columns (`state`, `from_value`, `to_value`, `revision`, `ref`, `reply_ref`, `role`, `action`, `pending`, `pull_request`, `note`) |
| `meta` | Key and value |

Rounds and finding updates are stored as structured columns (`intro_items` and `updates`), never as pre-rendered Markdown strings. `renderReport`, `showText`, and `dumpReview` format the bullet text from them at render time with `formatRoundItem` and `formatUpdateItem` (`review-render.ts`).

The pull request half (the snapshot of the last `pr sync`):

| Table | Content |
| --- | --- |
| `pr_pull_requests` | The one pull request: host, owner, repo, number, title, body, state, author, base and head, head sha, URL, `created_at`, `fetched_at` |
| `pr_reviews` | Reviews: author, state (`COMMENTED`, `PENDING`, …), body, times, commit, URL |
| `pr_threads` | Review threads: path, `line`, `original_line`, `start_line`, `original_start_line`, `is_resolved`, `is_outdated` |
| `pr_comments` | Review comments and conversation comments (`kind` is `review` or `issue`), with `ref` (see section 3), thread, review, reply-to, body, times, commits, diff hunk, URL |
| `pr_check_runs` | Check runs of the head commit that have annotations |
| `pr_check_annotations` | Their annotations, with `ref`, path, lines, `level`, title, message, raw details |

The database holds at most one pull request, the connected one. These tables are not `STRICT`. The ids that GitHub gives (node ids) are stored as text; the check run id is the database id (an integer).

The links. This is the DDL as it is in `src/review-store.ts`:

```sql
CREATE TABLE linkable (
  ref TEXT PRIMARY KEY CHECK (
    (ref GLOB '[rc][0-9]*' AND substr(ref, 2) NOT GLOB '*[^0-9]*')
    OR (length(ref) = 9 AND ref GLOB 'a[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')
  ),
  kind TEXT NOT NULL CHECK (kind IN ('review_comment', 'conversation_comment', 'annotation')),
  gone INTEGER NOT NULL DEFAULT 0 CHECK (gone IN (0, 1))
) STRICT;

CREATE TABLE comment_links (
  position INTEGER PRIMARY KEY CHECK (position >= 0),
  ref TEXT NOT NULL UNIQUE REFERENCES linkable (ref),
  role TEXT NOT NULL CHECK (role IN ('own', 'duplicate', 'note')),
  finding TEXT REFERENCES findings (id) DEFERRABLE INITIALLY DEFERRED,
  note TEXT,
  CHECK ((role = 'note') = (finding IS NULL)),
  CHECK ((role = 'note') = (note IS NOT NULL)),
  CHECK (ref NOT GLOB 'a*' OR role = 'duplicate')
) STRICT;

CREATE UNIQUE INDEX comment_links_own ON comment_links (finding) WHERE role = 'own';
```

The rules in these tables:

- `linkable` has one row for every comment (replies too) and every check annotation of the snapshot. A link can only name a row that is there. This is a foreign key, so the database enforces it. The operations in `review-links.ts` check it first, to give a message that says what to do (`r999 is not in the database; run "pr-comments pr sync --db <file.sqlite>" first, or check the id`, with `<file.sqlite>` replaced by the database path in `changeReviewState`).
- A ref is linked once (`UNIQUE`).
- `own` and `duplicate` name a finding. A `note` names none and has a reason.
- A finding has at most one `own` link (the partial unique index).
- A check annotation (`a…`) can only be a `duplicate`.
- The foreign key from a link to its finding is deferred. `saveReview` deletes all findings and inserts them again, so the key is checked when the transaction commits.
- `gone = 1` marks a row that the last sync did not find while a link still names it.

### 2.3 Reading and writing

| Mode | Commands |
| --- | --- |
| Creates the database | `init` |
| Opens it read-only | `finding list`, `finding show`, `link pending`, `pr show`, `report render` (writes only the report file), `report comments` (writes only `--out`), `report dump`. Also the loading step of `finding post` and `link reply` |
| Writes it | `pr connect`, `pr sync`, `round open`, `round update`, `finding add`, `finding set-state|set-severity|set-title|set-description`, `finding update`, `finding post`, `link own|duplicate|note|remove`, `link reply`. `finding post` and `link reply` write nothing in a dry run |

A read command must not change the committed file. A read-only connection (`new DatabaseSync(path, { readOnly: true })`) issues no write at all: no journal mode pragma, no lock file, not one byte. A manual check of all the read commands left the hash and the modification time of the file as they were. A read takes one read transaction, so it sees one state of the file even when another process commits meanwhile.

### 2.4 One transaction per change

`changeReviewState(dbPath, change, { snapshot?, pullRequest?, knownRef? })` in `review-files.ts` is the door for every change of the review, the links and the connected pull request. (`syncReviewFile`, for `pr sync`, has a transaction of its own, see 2.5.) It runs one synchronous `inTransaction(db, …, { immediate: true })` (`review-store.ts`, shared with `store.ts`):

1. `BEGIN IMMEDIATE`: the write lock is taken before anything is read. Writers in several processes run one after the other, each on what the one before saved.
2. When `pullRequest` is given, it checks that the review is still connected to that pull request (host, owner and repository compared without regard to case, the number exactly) and fails with `the review is connected to <url>, not to <expected>` if not. When a snapshot is given (a pull request that was just downloaded), `assertFreshSnapshot` checks that its `fetchedAt` is not earlier than the stored snapshot's `fetched_at`, failing with `a newer pull request snapshot (<stamp>) is already stored; run "pr-comments pr sync --db <db>" again` if stale; otherwise it saves the snapshot first. When `knownRef` (one comment ref or an array of comment refs) is given, `recordKnownCommentRef` records each comment ref (`r…` or `c…`) in `linkable` with `gone = 0` before loading state.
3. The state is loaded: the review, the links, the connected pull request, and the refs a link may name (`known`).
4. The synchronous `change` callback runs. It returns the new state. Pure modules such as `review-links.ts` write `DB_HINT_PLACEHOLDER` (`--db <file.sqlite>`) in their command hints, and `changeReviewState` replaces it with `--db <quoted-db-path>` (`quoteCliPath`) if `change` throws.
5. The same state object back means "nothing changed": nothing is written. Otherwise only the parts that differ are written (the review after checking with `refuseDatabase` that the report path is not a database, the links, the connected pull request).
6. `COMMIT`. Any error rolls the whole transaction back, a given snapshot too.

Mutating commands and `report render` run one at a time per review database. A connection waits up to 10 seconds for a lock (`timeout` of `DatabaseSync`), which guards read-only queries against a write transaction.

The texts of a review are checked when they come in (`review-ops.ts`): no control characters except tab and newline, no lone carriage return or line separator, a title on one line, a revision as one word.

`mutateReviewFile` is `changeReviewState` for changes of the review alone. The report is rendered on `init` and on every change of the review (written after the database is created or `COMMIT` succeeds; if the report write fails afterwards, the saved database change still succeeds with exit `0` and the CLI warns `Warning: the report <report> was not refreshed (<reason>); run "pr-comments report render --db <db>"` on `stderr`), and `report render` re-renders it on demand (or writes `--out`).

### 2.5 `pr sync` and the snapshot

`pr sync` needs a connected pull request (`pr connect` or `init --pr`). It downloads with `downloadPullRequest` (comments, reviews, threads and check annotations), then `syncReviewFile` runs one `BEGIN IMMEDIATE` transaction:

1. The review must be connected, and to the same pull request as the data (host, owner and repo compared without regard to case, the number exactly). `assertFreshSnapshot` also checks that the downloaded snapshot is not older than the stored one (comparing `fetchedAt`). If either check fails, it is an error and nothing is written.
2. `savePullRequest` replaces every `pr_*` row. A comment deleted on GitHub disappears. So do annotations that a new analysis removed.
3. It then reconciles `linkable`: one row per comment and per annotation in the data, with `gone = 0` (an annotation that appears twice counts once). A row that is not in the data any more becomes `gone = 1` when a link names it. Otherwise it is deleted.

Consequences:

- The links stay as they are. A linked comment that is gone stays linked, shows in `finding show`, and does not show in `link pending` (a pending item is a row of the data).
- A gone ref cannot get a new link (`known` holds only rows with `gone = 0`). `link remove` works on it. The gone row itself stays until the next sync deletes it, because nothing links it by then.
- A gone row that comes back in a later sync gets `gone = 0` again.
- `pr connect` to another pull request is refused while links exist. Without links it stores the new URL and clears the snapshot of the old pull request.

`pr show` reads `fetched_at` and the head of the snapshot. `fetched_at` is the time taken before the first request, so the data is at least as new as that moment.

### 2.6 `finding post` and `link reply`: recording the comment ref locally

A comment that was just written on GitHub is not in the stored snapshot yet, and a link may only name a row in `linkable`. Instead of re-downloading the pull request after every write, both commands record the returned comment ref in `linkable` inside the recording transaction:

1. They load the review read-only via `requireConnectedReview` and check what they can offline (connected pull request, a duplicate that has a finding with an own comment, …).
2. The engine writes to GitHub (`publish.ts` or `reply.ts`, sharing `github-write.ts`). A dry run stops here.
3. If the result is not an error and has a comment, `recordAfterWrite` calls `changeReviewState(…, { pullRequest, knownRef })`, which verifies the review is still connected to `pullRequest`, records `knownRef` in `linkable` with `gone = 0` (`finding post` passes the posted comment ref; `link reply` passes `[ref, replyRef]` so a target ref previously marked `gone = 1` is restored to `gone = 0`), and records the link or reply update in one transaction.

If step 3 fails, the transaction is rolled back (`linkable` included) and the error says how to record the link by hand (or to run `link reply` again). A rerun finds the comment again and records it.

On the next `pr sync`, `reconcileLinkable` keeps the row with `gone = 0` when the comment is in the downloaded snapshot, or marks it `gone = 1` if it was deleted while a link still points at it (and drops an unlinked reply ref if deleted).

## 3. Ids

| Id | Meaning | Where it comes from |
| --- | --- | --- |
| `F7` | A finding | The next free number of the review. An id is never reused. Input is case-insensitive |
| `r544830` | A review comment (inline or file) | The number at the end of the comment's link, `#discussion_r544830` |
| `c623843` | A conversation comment | `#issuecomment-623843` |
| `a3f9c2d1e` | A check annotation | Computed, see below |

`r…` and `c…` are the GitHub database ids. The tool uses them as they are. The web UI cannot search a comment by id, so the report links every id to its comment (section 8). They stay the same when a pending review is submitted (checked on a real submit: same id, same link, same text; only `updatedAt` moved).

A check annotation has no id on GitHub. Its id is `a` and the first 8 hex digits of the SHA-256 (UTF-8) of

```
<app> NUL <path> NUL <start line> NUL <end line> NUL <message>
```

where `<app>` is the slug of the app that published the check suite (the lower-cased name when there is no slug, `unknown` when there is no app), and NUL is the character `\0`. So:

- The same issue found again in unchanged code has the same id. Another check run or another commit does not matter.
- The id changes when the issue moves to other lines or when its message changes (a number in the text, for example). The annotation is then a new one.
- Two annotations with the same app, path, lines and message are one id.

A comment whose link has no readable id cannot be linked. The text of a review verdict has no id of its own, so it cannot be linked either.

## 4. From a finding to a comment

`finding post <finding>` builds the comment directly from the finding in the database (`extractComment` in `report-extract.ts`). The report file is never read. The publish engine (`publishComment`) gets the comment as data (`PublishComment`: path, lines, commit, the ref of the own comment, the text), not as a file. `report-extract.ts` checks the place it builds: the path is made repository-relative (backslashes become `/`, a leading `./` goes) and refused when it is empty, absolute or has `..` segments, and lines must start at 1 or later and not run backwards (`cannot extract <finding>: …`). A `--commit` must be 7 to 40 hex digits and is passed on in lower case.

1. The review must be connected to a pull request. The state of the finding does not matter: a finding in any state can be posted, also with `--dry-run`. The state is not part of the comment (only the severity, the id and the title are).
2. Anchors. An anchor is a line of the description, outside code fences, that holds only `` `path:start` `` or `` `path:start-end` ``. The first one is the place of the comment. `--anchor <n>` takes another one (1-based; out of range is an error). The output lists every anchor.
3. The text is `<severity> **<id> — <title>**`, a blank line, and the description. For example `🔴 **F1 — Tenant lookup never gives up**`. The id is the one of the review document, so a person can match the comment with the finding. It is local to the review: the pull request author does not know it. A comment posted before the id was added is updated with it by running `finding post` again (it counts as an update, see item 8). Only the description goes to GitHub, never the Updates. With `--by-agent` the first line is `🤖 *Written by an AI agent.*`, then a blank line.
4. Links are stripped. An inline link whose target is relative (no scheme, not `//`, so also `#section`) is replaced by its text. It points into the review, which the author of the pull request cannot open. The count shows as `links removed: <n>`. Links in code fences and code spans are left alone. Absolute links stay. Relative images and reference-style links stay as written, and each one gives a warning. So does a mention of the report's own name or of a `round-<n>/` path.
5. No anchor means a general (conversation) comment, which needs `--now`. A warning says so.
6. A file-level finding has no special form. It is anchored at the first line: `path:1`. That is an inline comment on line 1. It works when line 1 is inside a diff hunk of the pull request, which is true for every file the pull request adds. In a file that the pull request only changes, line 1 is usually not in a hunk. The post is then refused and the message lists the commentable ranges. Anchor the finding at one of them.
7. `--commit <sha>` (7 to 40 hex digits) pins the comment to a commit. It is not resolved with local git: GitHub resolves it (`repository.object(expression)` in GraphQL), because `commitOID` and `commit_id` need the full id. A commit that is a prefix of the pull request head counts as no pin. See section 5 for what pinning means.
8. `link own` records an existing comment as the own comment of a finding. When a finding has one, `finding post` updates that comment. Only your own comments can be updated. A posted comment cannot move: another path or other lines (a different `--anchor`) is an error. A comment that is gone on GitHub (or was in a discarded pending review) is an error too. All three say to remove the link with `link remove` and post again. That creates a new comment, and the old one stays on GitHub until you delete it. The engine tells which of the three it is (`reason` of the error result: `gone`, `moved`, `not-yours`), and `review-post.ts` adds that advice; the engine does not know the database.
9. Without an own link, the engine looks for an identical comment of yours (same text after trimming and normalising line breaks, same place). It adopts that comment instead of creating another one (`adopted PR comment [r…](<url>) (identical)` under Updates).
10. The result has the action `created`, `updated`, `unchanged` or `error`, and the state `pending` or `posted`. The Updates entries are `posted PR comment [r…](<url>)` (with `to the pending review` when pending), `updated PR comment [r…](<url>)` and `adopted …`. `<url>` is the comment on the connected pull request (section 8).

The output of `finding post` is one result line (action, state, comment id, place, URL, note), the line `anchor <n> of <total>: <path>:<lines>` (or `no anchor: general comment`), one `  <n>. <path>:<lines>` line for each other anchor, and `links removed: <n>`. With `--dry-run` the exact text follows between `----- comment text -----` and `-----`. With `--json` the output is one object: `finding`, `result`, `anchors`, `chosen`, `warnings`, `unlinked`, `body`. The `result` has `action` and `dryRun`, and, when they apply, `comment`, `state`, `url`, `commentId`, `path`, `lines` and `message`. The exit code is 1 when the result is an error. Warnings go to stderr as `Warning: <text>`.

`link reply` has the same result line (the place is the place of the answered comment, or `conversation`), then `answers <ref> (<author>[, thread open|resolved])`, then the text between `----- reply text -----` and `-----` in a dry run. Its `--json` object has `finding`, `own`, `link`, `text`, `result`. The thread state is information only.

The calls that the engines make:

| Case | Call |
| --- | --- |
| Inline or file comment, default | GraphQL `addPullRequestReviewThread`: the viewer's pending review, or a new one when there is none. Lines are those of the diff at the pull request head, right side. `subjectType` is `LINE` or `FILE`, and `startLine` makes a range |
| With `--commit`, no pending review yet | GraphQL `addPullRequestReview` with `commitOID` and one thread. The lines are those of that commit |
| Inline with `--now` | REST `POST /repos/{o}/{r}/pulls/{n}/comments` with `commit_id` (the head, or the pinned commit), `line` and `side` (and `start_line`, `start_side`) |
| General comment, `--now` | GraphQL `addComment` |
| Update | `updatePullRequestReviewComment` or `updateIssueComment` |
| Reply in a thread | `addPullRequestReviewThreadReply` with the id of the pending review. `addPullRequestReview` (empty) first when there is none |
| Reply to a conversation comment | `addComment` (with `--now`) |
| Check of the place | REST `GET /repos/{o}/{r}/pulls/{n}/files`, 100 per page, at most 30 pages (GitHub lists at most 3000 files) |

The place is checked before anything is written (`validateAnchor`). The file must be in the diff and must not be removed. A range must lie inside one hunk of the right side. A file without a `patch` (binary or too large) cannot get an inline comment (`GitHub gives no diff for … (binary or too large)`). The error lists up to 8 commentable ranges. A pinned comment only has its path checked, because the hunks of the head do not describe another commit.

## 5. GitHub behaviours learnt from live tests

All of this was found with live runs against one GitHub Enterprise Server (3.19.4), with a classic token. Test data was deleted afterwards. Things that were not tested are in section 11.

### Pending review

- A user has one pending review per pull request. Only that user sees it.
- `addPullRequestReviewThread` creates the pending review at the head when there is none, and appends to it when there is one. So "post to the pending review" needs no extra step.
- Creating a second pending review fails: `User can only have one pending review per pull request` (GraphQL, type `UNPROCESSABLE`). REST says `user_id can only have one pending review per pull request` (HTTP 422).
- While a pending review exists, no single comment can be published. The REST call for `--now` answers 422 for every valid request. So the tool refuses up front: `you have a pending review; GitHub cannot publish a single comment while it exists. Submit or discard it in the web UI, or post without --now`. An existing comment that lives in the pending review cannot be published on its own either.
- The viewer's pending review, its threads and its comments are returned by the same queries as everything else, with state `PENDING`. Only the token of that user sees them. The viewer-specific fields of GraphQL (`viewerLatestReview` and similar) do not include a pending review.
- A pending comment keeps its id and its link when the review is submitted. A link to a pending comment is plain text. It works for everybody after the submit, and it is dead for ever when the review is discarded.
- `deletePullRequestReview` removes the review at once, but its comments disappear within seconds. Do not trust a read in the same second.
- Editing a pending comment changes `updatedAt` but not `lastEditedAt`. So `report comments` cannot mark an edited pending comment as edited. An edit of a posted comment sets `lastEditedAt`.

### Lines and commits

- `addPullRequestReviewThread` ignores the commit of the review. Its `line` refers to the diff at the pull request head.
- `addPullRequestReview` with `commitOID` and inline threads takes the lines from that commit. The comment then has `originalCommit` = that commit. GitHub maps `line` to the head, or gives `null` and marks the thread outdated. This is only possible when the review is created, so `--commit` is refused while a pending review exists. File-level comments cannot be pinned.
- A GraphQL `commitOID` and a REST `commit_id` need the full 40-character id. An abbreviation is a 422 (`commit_id is not part of the pull request`, which is misleading) or a coercion error. The tool resolves it first.
- A range comment needs `startLine` before `line`, both in the same hunk. Equal lines give a silent failure.

### Silent failures

- `addPullRequestReviewThread` answers an invalid place, or an empty body, with HTTP 200, no `errors`, and `thread: null`. The tool checks the diff first, and treats `null` as a failure (`GitHub rejected the comment (is the anchor still part of the diff?)`). In one test such a call also left an empty pending review behind. If you see an empty draft review after a failed post, delete it in the web UI.
- `addPullRequestReviewThreadReply` with an empty body answers `comment: null`, no error, and leaves a stray empty pending review. The tool never sends an empty body, and treats `null` as a failure.
- Inline threads inside `addPullRequestReview` fail loudly instead (`UNPROCESSABLE`) and leave nothing behind.
- Several mutations in one GraphQL document give HTTP 200 with partial `data` and `errors`. The client throws on `errors` and drops `data`, so the tool sends one mutation per request.
- Some refusals have an empty message. The client shows them as `(<type>, no message)`.

### File-level and single-line threads

- A file-level thread (`subjectType: FILE`) is read back with thread `line` = 1, comment `line` = `null` and `diffHunk` = `""`. So the tool tells a file-level thread by the empty diff hunk, not by the line.
- For a single-line thread, GitHub gives the thread `startLine` = `line`, and the comment `startLine` = `null`. A range has `startLine` different from `line`.
- For an outdated range thread, GitHub gives `line` = `null` and `startLine` = `null`, keeping the range in `originalStartLine` and `originalLine` (`threadRange` in `model.ts` reads `originalStartLine` when `line` is `null`, and `originalLines` in `publish.ts` reads it for an outdated thread or a comment pinned to another commit).

### Replies

- The call is GraphQL `addPullRequestReviewThreadReply`. REST `…/replies` is immediate and fails with 422 while a pending review exists.
- Whether a GraphQL reply is immediate or pending is not decided by the caller. Without a pending review the reply is posted at once (it gets its own `COMMENTED` review). With a pending review it silently joins it. That is the trap, so the tool always passes the pending review id.
- When there is no pending review, the tool creates an empty one with `addPullRequestReview` and replies into it. If the reply fails, it deletes the review it created. It never deletes a pending review it did not create. A thread reply is never immediate, and `--now` has no effect on it.
- A reply to a reply is flattened into the thread of the first comment. A reply never resolves a thread, and a resolved thread still takes replies.
- Every immediate reply adds one `COMMENTED` review to the pull request.
- A conversation comment has no thread and no pending state. The only answer is a new conversation comment, which is visible at once, so `link reply` wants `--now` for it. The link in that text opens for others only after the review with the own comment is submitted.
- A conversation comment whose whole text is `Duplicate of <link>` is refused by GitHub with an empty message. With the final period, `Duplicate of <link>.`, it is accepted. So the text always ends in a period. The same text works in review threads.
- The own comment of the finding must still be in the freshly read pull request. If it is gone (a discarded pending review, for example), `link reply` refuses before it writes anything, also in a dry run, and says to remove the link and post the finding again.
- A rerun does not reply twice. An identical reply of yours in the thread (a pending one counts) is `unchanged`.
- The tool never resolves, hides or edits a comment of somebody else. `resolveReviewThread` and `minimizeComment` exist and work with a write token, but they are not used.

### Errors

- A GraphQL error comes with HTTP 200. The client throws on any `errors`.
- HTTP 401 and 403, a GraphQL error of type `FORBIDDEN` and a message `Resource not accessible …` are "access denied". The next token is tried (section 7). Validation errors are never confused with these: they are HTTP 200 `UNPROCESSABLE` or `NOT_FOUND`, or REST 422 and 404.
- REST 404 is not taken as "access denied".
- The GraphQL error `Could not resolve to a Repository` or `… to a PullRequest` is also taken as "access denied". The pull request may be missing, or hidden from this token, so the next token is tried.

## 6. Check annotations

SonarQube and similar tools publish their issues through the Checks API. GitHub shows them in the diff as "Check failure on line 132". They are not comments. They have no author, thread or id.

`pr sync` reads them with GraphQL:

- Only the head commit of the pull request (`commits(last: 1)`).
- Every check suite of that commit, then the check runs of each suite. The runs are the latest ones: the query sets no filter, and GitHub's default for `checkRuns` is the latest run of each check. In a live read of a pull request with re-run checks, `filterBy: ALL` gave 7 runs where the default gave 3, so nothing is counted twice.
- Only runs that have annotations are kept. A run without any (commit lint, code owner approval, a plain build) says nothing about a place in the code, and is never stored.
- All levels are kept: `notice`, `warning`, `failure`.
- Page sizes: 100 for comments and annotations, 20 for suites and runs. GitHub refuses a query that could return more than 500,000 nodes, which 100 suites of 100 runs of 100 annotations would be.
- The app that published the run is its "author": the suite's app slug.
- If reading the check runs fails, the whole sync fails (`reading the check runs failed: …`). It does not silently skip the checks. An access error keeps its meaning, so that another token can be tried.

SonarQube deletes its annotations and publishes new ones when it analyses a new commit. So a sync replaces the check runs as a whole. A link to an annotation that is no longer there stays, marked `gone` (section 2.5). The annotations of earlier commits are not stored.

`report comments` ends with a `## Checks` section: one `###` heading per check run (`<name> — <conclusion>`, sorted by name), a line with the app, the commit, the number of annotations and a link to the details, and one item per annotation (id, level, place, message; a title that only repeats the place, such as SonarQube's `path#L132`, is left out). `--author` takes the app as the author of its check run.

## 7. Tokens

A token is sent only to the host of the pull request URL. A token must be a single line of visible ASCII characters (an invalid header value makes `fetch` throw an error that contains the whole value, so it is rejected earlier). An empty token file is an error.

Where the tool looks, most specific first. Inside one scope the environment variable comes before the file:

| Scope | Environment variable | File in `~/.config/tokens` (Windows: `%USERPROFILE%\.config\tokens`) |
| --- | --- | --- |
| Host and owner | `PR_COMMENTS_TOKEN_<HOST>__<OWNER>` | `<host>_<owner>` |
| Host | `PR_COMMENTS_TOKEN_<HOST>` | `<host>` |

- In the variable name, upper-case the host and the owner and replace every character other than `A-Z` and `0-9` with `_`: `PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM__ACME`.
- In the file name, every character other than letters, digits, `.`, `_` and `-` becomes `_`. So a port is `ghe.example.com_8443`. The file is found without regard to case, because host and owner names are case-insensitive on GitHub and Linux file names are not.
- A token found in several places is listed once.
- No token at all is an error that names the file and variable names to use.

When there are several tokens (`withWorkingToken`):

1. The token source that worked last time for this host and owner goes first.
2. A token that is refused (see "Errors" in section 5) is skipped and the next is tried. Any other error (network, server) is reported at once.
3. A refused request is retried with the next token while nothing has been written. The comment engine writes at most one comment per run, and the write is its last request, so a refusal never comes after a write there. `link reply` is different: once it has created its empty pending review, a refused reply is final (the empty review is deleted) and is not retried.
4. If every token is refused, the error lists the sources that were tried (file paths and variable names, never tokens).

The memo is `~/.cache/pr-comments/token-sources.json`. Its keys are `<host>/<owner>` (lower case) for reading and the same with `#write` for writing. Its values are source names such as `file:ghe.example.com` or `env:PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM`. It never holds a token. A missing or broken memo is ignored, and a failed write of it is ignored.

A dry run also writes the memo: it records which token source worked for writing, because it has to ask GitHub.

Read and write:

- `pr sync` reads. `finding post` and `link reply` write.
- A token that can read may be refused for a write. Then the next token is tried, and the one that worked is remembered under the `#write` key.

Kinds of token:

- A classic token with the `repo` scope reads and writes every repository you can access.
- A fine-grained token belongs to one resource owner. Choose the organization that owns the repositories, not your user, or its private repositories stay invisible (`Pull request … was not found or the token cannot access it (a fine-grained token must have the repository selected)`). It needs Pull requests: Read to sync (Metadata: Read is added by GitHub) and Pull requests: Read and write to post. GitHub's documentation puts check run annotations under Checks: Read. This was not tried with a fine-grained token.

## 8. The report

`report render` writes `<stem>.md` next to the database (or `--out`) using `renderReport` (`review-render.ts`). The report is strictly write-only — the tool never reads or parses a report. The format is `# Review — <target>`, Intro with **Reviewed**, Dashboard, Findings (a sample follows). There is no hand-edit guard and no hash: the report is derived text and is overwritten each time. It prints `created`, `updated` or `unchanged` and the path. It refuses a target that is a SQLite file, and `--out` that ends in `.sqlite`. The report always has LF line breaks and a generated Dashboard.

This is a real report of a small review (shortened):

````markdown
# Review — PR 42 tenant registry

## Intro

**Reviewed**

- Round 1 — `75c05c94`, base `16281d9a`; scope: src/tenants only

## Dashboard

<!-- generated by pr-comments — do not edit by hand -->

### ✅ 1 approved

  1. [F1](#--f1--tenant-lookup-never-gives-up)

## Findings

### ✅ 🔴 F1 — Tenant lookup never gives up

#### Description

`src/tenants/registry.ts:22-32`

The lookup loop never gives up. …

#### Updates

- 2026-10-11 15:06 — Round 1: raised ⏳
- 2026-10-11 15:06 — ⏳ → ✅ — the user agreed
- 2026-10-11 15:06 — PR comment [r544861](https://github.com/acme/widgets/pull/42#discussion_r544861) linked as its own — written by hand
````

- Sections: `# Review — <target>`, `## Intro`, `## Dashboard`, `## Findings`.
- The Intro has one entry, **Reviewed**: one item per round, `Round <n> — `<revision>`, base `<base>`[; note]`, or `base none — reviewed as it stands`. The note is the free text of `round open --note` (and any notes appended by `round update`), so the scope and round outcome of the review are written there.
- The Dashboard is generated from the findings and starts with the marker line `<!-- generated by pr-comments — do not edit by hand -->`. One `### <marker> <n> <label>` block per state that has findings, with numbered links to the findings.
- A finding is `### <state> <severity> <ID> — <title>`, then `#### Description` (the text as stored) and `#### Updates` (bullets).
- Updates entries are `<yyyy-mm-dd hh:mm> — [Round <n>: ]<what>[ — <note>]`, in local time. What each command writes:

  | Command | Entry |
  | --- | --- |
  | `finding add` | `Round <latest>: raised ⏳` (`❓` with `--unverified`) |
  | `finding set-state` | `<old> → <new>`, then ``at `<revision>` `` when given |
  | `finding set-severity` | `severity <old> → <new>` |
  | `finding set-title` | `title changed: "<old>" → "<new>"` |
  | `finding set-description` | `description revised` |
  | `finding update` | the text |
  | `link own`, `link duplicate` | `PR comment [r…](<url>) linked as its own`, `… linked as a duplicate`, `check annotation a… linked as a duplicate` |
  | `link remove` | `PR comment [r…](<url>) unlinked (was a duplicate)`, `(was its own)` |
  | `finding post` | `posted PR comment [r…](<url>)[ to the pending review]`, `updated PR comment [r…](<url>)`, `adopted PR comment [r…](<url>) (identical)` |
  | `link reply` | `replied to duplicate [r…](<url>) with [r…](<url>)[ in the pending review]` |

  A `--note` is added after ` — `. `--round <n>` adds `Round <n>: ` at the start. It must name a round that was opened. `link note` writes nothing under Updates, because a note belongs to no finding. Nothing else writes under Updates.
- The report carries the URL of every comment it names, because the web UI cannot search comments by id. In the table `[r…](<url>)` is the id as a markdown link to the comment on the connected pull request, `<pull request URL>#discussion_r…` (`#issuecomment-…` for a `c…`). The pull request URL is stored on the structured update entry when the entry is made, and `renderReport` compiles the link from that field at render time, so `renderReport` stays a function of the review data alone. A check annotation has no URL on GitHub and stays bare (`check annotation a…`), and so does a comment of a review that is not connected to a pull request.
- The links and the pull request are not in the report. They are only in the database (and in `report dump`).

`report dump` is a text form of the review for `git diff`:

- The first line is `review-db v1` (the version of the dump format, not of the schema).
- Header values are JSON. Every free-text line starts with `| `, so text can never pass for structure. A change of one finding changes only the lines of that finding. Nothing is numbered across findings.
- After the findings come, when there are any, `pull_request="<url>"` and one line per link, in link order: `link <ref> role="…" finding="…" note="…"` (`finding` for `own` and `duplicate`, `note` for `note`).
- It carries no time of its own and none of the downloaded rows.

## 9. Revisions

`round open --revision/--base` and `finding set-state … --revision` take anything git names a commit by. The CLI resolves it in the repository of the working directory:

```
git rev-parse --verify --quiet --short=8 <rev>^{commit}
```

and stores the short lower-case hash (at least 8 characters, longer when git needs more to disambiguate). `HEAD`, branches, tags, abbreviations and expressions such as `HEAD~1` work, and none is stored as typed. `round open --revision` defaults to `HEAD`. `--base <rev>` or `--no-base` is required for `round open`.

Errors: no git repository (`not inside a git repository (run the command in the reviewed repository)`), a revision that does not exist, an ambiguous abbreviation, something that is not a commit (`HEAD^{tree}`), a revision that starts with `-` or holds a control character, and git that cannot be started. git runs with `LC_ALL=C`, because its messages are matched by their English text.

`finding post --commit` is different: it is not resolved with local git (see section 4).

The revision of a round is checked as one word (no spaces, no backticks) because it is written between backticks in the report.

## 10. Build and tests

Build:

- `pnpm build` runs `scripts/build.ts`. It bundles `src/cli.ts` and everything it imports into one ES module with rolldown (`platform: 'node'`): `../../skills/review-with-docs/pr-comments.mjs`, with a shebang and a notice that it is generated. `--out <file>` writes it elsewhere.
- Only `node:` built-ins stay as imports. The file needs Node 24.15 and nothing else.
- `pr-comments --version` prints the version of `package.json`. The bundle adds the build id that the build script sets (`__BUILD__`): `pr-comments 0.1.0+75c05c9` (the short commit, with `-dirty` when tracked files under `tools/pr-comments/` have uncommitted changes, and nothing without git). A copy of the bundle that fell behind can be recognised by it.
- `bin` in `package.json` points to `./src/cli.ts`. A global install must link the project (`pnpm add -g .`). Node refuses to run TypeScript files under `node_modules`, so a copy from a tarball or registry would fail with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

Tests (`pnpm test` runs `vitest run`; `pnpm typecheck` runs `tsc --noEmit`):

- A test file sits next to each module: `src/<module>.test.ts`. They run offline. GitHub is replaced by fakes: an injected `fetch`, GraphQL and REST clients, and the `CliEnvironment` of `cli.ts` (`getPullRequest`, `publish`, `reply`, `resolveRevision`, `print`, `warn`, `cwd`, `now`, `readStdin`). No test writes to GitHub.
- Test data is inline. `src/fixtures.ts` has a sample pull request. `src/review-test-support.ts` has the helpers of the database tests: scratch folders, a snapshot with chosen refs, a sample review and report that use every part of the model.
- Scratch folders for the review-database, git-revision, and bundle tests are under the git-ignored `out/` (`token`, `download`, and `review-naming` tests use the temporary folder of the system).
- `src/git-revision.test.ts` creates real git repositories (commits, branches, tags, an ambiguous abbreviation). Each has a repository of its own inside the one of the project.
- `scripts/build.test.ts` builds the bundle and compares what it prints with what the sources print: help, errors, the pull request as markdown, links, a review made from another folder.
- `src/cli.test.ts` covers the command line: every command, strict arguments, help, exit codes, the stderr line.
- `src/review-ops.test.ts` and `src/review-render.test.ts` cover input validation and one-way report rendering across all states, severities, and markdown constructs.

## 11. Known limitations

- File-wide findings. A finding about a whole file is anchored at line 1. For a file that the pull request only changes, line 1 is usually not inside a hunk, so the post is refused (the message lists the commentable ranges). In one real pull request with 109 files, 63 files were added and 33 of the 39 modified `.ts`, `.html` and `.scss` files had no hunk at line 1. An idea that is not built: attach to the first commentable line of the file, with a visible note.
- Fine-grained tokens and checks. Reading check run annotations with a fine-grained token (Checks: Read) was not tried. A token that cannot read them makes `pr sync` fail instead of skipping them.
- Live tests ran on GitHub Enterprise Server 3.19.4 only, with a classic token. Not tried: github.com, the exact error for a write without permission (it should be `FORBIDDEN`, which is mapped to "access denied"), what a pending review does when the head of the pull request moves after it was created, what `--commit` does at submit time, and a cross-hunk range.
- The reply tests ran on a closed draft pull request. Replies on a closed pull request work. Differences on an open one were not seen.
- Pending reviews are visible to their author only. A snapshot is complete for the pending comments of the user whose token made it. It was not tried with a second account.
- An edited pending comment is not marked as edited (section 5).
- The text of a review verdict has no comment id, so it cannot be linked and `link pending` does not list it.
- Only the head commit's check annotations are kept. After a push, run `pr sync` again.
- A database is one writer at a time. A binary file cannot be merged: after a git conflict take one side and redo the other changes with the commands.
- No cross-version migration. A database of an older schema version must be started again with `init` (within schema 6, `savePullRequest` — run by `pr sync` — adds `pr_threads.original_start_line` if absent).
