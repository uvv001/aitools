# pr-comments

`pr-comments` keeps the code review of one GitHub pull request in one SQLite file.

The file holds the findings, the rounds, the links from findings to comments, and the downloaded pull request itself. The tool publishes findings as comments into your pending review, and it renders markdown reports. It uses the GitHub API of github.com and of GitHub Enterprise Server. The live tests so far ran against Enterprise Server.

It is made for a person or an AI agent that reviews a pull request. The commands print short lines, and every command has `--help`.

Technical details (schema, ids, GitHub behaviours, tokens) are in [docs/technical.md](docs/technical.md).

## Install

You need Node 24.15 or newer, and pnpm.

```
pnpm install
pnpm add -g .
```

`pnpm add -g .` links the project, so `pr-comments` runs from any folder, and `git pull` updates it. If the command is not found, run `pnpm setup` once and restart the shell. Inside the project, `pnpm start <args>` does the same without the global install.

For a place without the repository, build one file:

```
pnpm build                                      # writes ../../skills/review-with-docs/pr-comments.mjs
pnpm build --out <folder>/pr-comments.mjs       # writes it elsewhere
node <folder>/pr-comments.mjs --version
```

The bundle needs only Node 24.15: no `node_modules`, no installation (the runtime guard refuses Node 22.13–24.14 with a version error; older Node versions fail when loading `node:sqlite`). It behaves exactly like the global command. `--version` shows the version and, for a bundle, the commit it was built from (`pr-comments 0.1.0+75c05c9`, with `-dirty` when the sources had uncommitted changes).

### Token

`pr sync`, `finding post` and `link reply` talk to GitHub, so they need a token. Everything else works offline.

Put the token in a file, on one line:

```
~/.config/tokens/<host>_<owner>      only for that organization or user, e.g. github.com_acme
~/.config/tokens/<host>              any owner on that host, e.g. github.com
```

On Windows the folder is `%USERPROFILE%\.config\tokens`. Or use an environment variable: `PR_COMMENTS_TOKEN_<HOST>__<OWNER>` or `PR_COMMENTS_TOKEN_<HOST>` (upper case, other characters as `_`, e.g. `PR_COMMENTS_TOKEN_GITHUB_COM__ACME`). The most specific one is tried first, and a token is only sent to the host of the pull request.

A classic token with the `repo` scope is the simplest. `finding post` and `link reply` need write permission. The full rules (several tokens, fine-grained tokens, the memo file) are in [docs/technical.md](docs/technical.md#7-tokens).

## The flow

This is one complete review of a pull request, in order. The example reviews pull request 42 of `acme/widgets`. Run the commands in the reviewed repository: revisions are resolved with git there. Lines that start with `pr-comments` are commands. The lines after them are what the tool printed. The line `Review database: <path>`, which the commands that change the database print on stderr, is left out.

**1. Start the review.** `init` creates the database. The name is the title of the report.

```
pr-comments init "PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42
Created .ai/review-with-docs/2026-10-29_pr-42-tenant-registry_review.sqlite
Pull request: https://github.com/acme/widgets/pull/42
Report: .ai/review-with-docs/2026-10-29_pr-42-tenant-registry_review.md
```

Both the database and the report are created, and every change updates the report after the database change commits (if writing the report file fails afterwards, the database change stays saved, the command exits `0`, and `stderr` prints `Warning: the report <report> was not refreshed (<reason>); run "pr-comments report render --db <db>"`). Without `--db`, the files go to `.ai/review-with-docs/<yyyy-mm-dd>_<name as a slug>_review.{sqlite,md}` at the git root; whenever `init` places a review under `.ai/review-with-docs/` (subfolders included), it checks with `git check-ignore`, adds `/.ai/review-with-docs/` to `.git/info/exclude` when not already ignored (while `.ai/` itself can remain versioned), and fails if a `.gitignore` rule still exposes the folder. Pass `--db <session-folder>/files/review-with-docs/<yyyy-mm-dd>_<slug>_review.sqlite` when storing the review in a session folder. Every subsequent command takes `--db <file.sqlite>` (`$DB` below). If the pull request does not exist yet, leave out `--pr`, and connect it later:

```
pr-comments pr connect https://github.com/acme/widgets/pull/42 --db $DB
Connected to https://github.com/acme/widgets/pull/42
```

**2. Open a round.** A round is one pass over a revision, compared with a base. `--note` is optional: write the scope of the review (or any other context) there. It goes onto the Reviewed line of the report.

```
pr-comments round open --base origin/main --note "scope: src/tenants only" --db $DB
Round 1 opened
```

The revision is `HEAD` unless you say `--revision`. The tool stores the short hash (at least 8 characters) of the commit.

**3. Raise findings.** The description is a markdown file (or `-` for standard input). A line that holds only `` `path:lines` `` is an anchor. It says where the comment goes in the pull request.

```
pr-comments finding add --severity high --title "Tenant lookup never gives up" --description-file notes/retry.md --db $DB
Added F1
pr-comments finding add --severity medium --title "Failed lookups are swallowed" --description-file - --db $DB
Added F2
```

Here `notes/retry.md` starts with `` `src/tenants/registry.ts:22-32` ``, then the explanation, then a code block. The second description comes from standard input. A finding starts as ⏳ awaiting triage. A round must be open.

**4. Triage.** Look at the findings, and decide.

```
pr-comments finding list --db $DB
F1  ⏳ 🔴  Tenant lookup never gives up
F2  ⏳ 🟡  Failed lookups are swallowed
2 of 2 findings
pr-comments finding show F1 --db $DB
pr-comments finding set-state F1 approved --note "the user agreed" --db $DB
F1: ⏳ → ✅
pr-comments finding set-state F2 approved --db $DB
F2: ⏳ → ✅
pr-comments finding update F2 "Asked the author about the log level" --round 1 --db $DB
F2: note added
```

`finding show` prints the description and the Updates. `finding set-severity`, `set-title` and `set-description` change the rest. Every change is logged under the Updates of the finding.

**5. Download the pull request.** `pr sync` reads the comments, reviews, threads and check annotations from GitHub into the same database. It prints `Synced <owner>/<repo>#<n>: <r> reviews, <t> threads, <c> comments, <a> annotations`. Run it again after every push: it replaces what the last sync stored.

```
pr-comments pr sync --db $DB
pr-comments pr show --db $DB
```

`pr show` tells when the data was downloaded, the head commit, and how much the database holds.

**6. Deal with what others wrote.** `link pending` is the to-do list for top-level comments and check annotations. It prints every top-level comment and every check annotation of the pull request that no link names yet. Read full pending threads with `report comments --pending`, and read `report comments` for submitted review bodies, unlinked replies in already linked threads, and edited linked comments.

```
pr-comments link pending --db $DB
  r544861  erin  src/tenants/registry.ts:22  thread open, 0 replies — "The tenant lookup never gives up: add an upper bound."
  r544900  bob   src/tenants/registry.ts:25  thread open, 1 reply — "This loop has no limit. A dead tenant blocks the worker."
  c623843  dave  conversation                "Can we also log the retry count?"
  a126305ce  sonarqube-cloud  failure  src/tenants/registry.ts:22  "Refactor this method to reduce its Cognitive Complexity from 19 to the 15 allow…"
  a8d5d4a2a  sonarqube-cloud  warning  src/tenants/retry.ts:7      "Either log or rethrow this exception."
```

Go through the list. Each line gets a link:

- A comment you wrote by hand that says what a finding says: `link own`.
- A comment (or check annotation) about the same issue as a finding: `link duplicate`.
- A comment that is no finding: `link note`, with the reason.
- A new issue: first `finding add`, then link it to that finding. A check annotation is always linked as a duplicate of a finding. It is never a note.

```
pr-comments link own F1 r544861 --note "written by hand" --db $DB
F1: own comment r544861 linked
pr-comments link duplicate F1 r544900 --db $DB
F1: duplicate r544900 linked
pr-comments link note c623843 "a wish, not a finding" --db $DB
c623843: noted
pr-comments finding add --severity low --title "Cognitive complexity of Registry.resolve" --description-file - --db $DB
Added F3
pr-comments link duplicate F3 a126305ce --db $DB
F3: duplicate a126305ce linked
pr-comments link duplicate F2 a8d5d4a2a --db $DB
F2: duplicate a8d5d4a2a linked
```

When `link pending` prints nothing, every top-level comment and check annotation is linked. Empty output means no top-level item is left in the pending list. The exit code is 0 whether it printed something or not, so pending work is never a failure. (Before the first `pr sync` it is an error instead.) Replies are not listed in `link pending`: their thread is represented by its first comment, so read `report comments` to inspect replies, edited comments, and review bodies.

**7. Post the findings.** `finding list --unposted` shows the findings that have no comment of their own yet, in any state; `--state approved` narrows it to the approved ones. First look at what would happen, then post:

```
pr-comments finding list --state approved --unposted --db $DB
F2  ✅ 🟡  Failed lookups are swallowed
1 of 3 findings
pr-comments finding post F2 --dry-run --db $DB
pr-comments finding post F2 --db $DB
```

`--dry-run` checks everything and prints the exact text and the place, and writes nothing. A real post adds the comment to your **pending review**. Nobody else sees it until you submit that review. The tool links the comment to the finding as its own comment. `--now` publishes at once instead, but GitHub allows that only when you have no pending review. A finding without a `path:lines` anchor becomes a general comment, which needs `--now`. A finding in any state can be posted, for example one that is already ✅ approved or 🔧 fixed: the state is not part of the comment.

**8. Answer the duplicates.** A comment that duplicates a finding can be answered with `Duplicate of <link to the own comment>.` The answer goes into the same pending review.

```
pr-comments link reply r544900 --dry-run --db $DB
pr-comments link reply r544900 --db $DB
```

`F1` has the own comment `r544861`, so the reply to the duplicate `r544900` points to it. A conversation comment (`c…`) can only be answered at once, so it needs `--now`. Check annotations are never answered.

**9. Submit the pending review in the GitHub web UI.** One submit sends all your comments and replies to the author at once. This is one round of review. The tool never submits for you.

**10. Make the reports.**

```
pr-comments report render --db $DB
pr-comments report comments --out .ai/review-with-docs/pr-42_comments.md --db $DB
Wrote .ai/review-with-docs/pr-42_comments.md
```

`report render` writes the review report next to the database, and prints `created`, `updated` or `unchanged` and the path. `report comments` writes the pull request as markdown (comments, reviews, threads, check annotations), to the screen or to a file.

**11. Next round.** The author pushes. Sync again, open a new round, and see what is new:

```
pr-comments pr sync --db $DB
pr-comments link pending --db $DB
pr-comments round open --base origin/main --db $DB
pr-comments finding set-state F2 fixed --revision HEAD --note "retry now logs" --db $DB
F2: ✅ → 🔧
```

`fixed` needs the revision that fixes the finding. Repeat from step 3 for new findings.

### What the tool never does

- It never resolves, hides or edits a comment of anybody else. Resolving a thread is a person's job on GitHub.
- The finding state `fixed` has nothing to do with a resolved thread. A finding changes state only with `finding set-state`.
- It never submits your pending review.
- It writes to GitHub in two commands only: `finding post` and `link reply`. `pr sync` only reads. The links are records in your database, and nothing is written to GitHub when you make them.
- It creates a database only with `init`, and never replaces an existing database or report file.

## Command reference

<!-- BEGIN GENERATED COMMAND REFERENCE -->
Every command also has `pr-comments <command> --help` (or `pr-comments help <command>`) with its options, and an example. `--db <file.sqlite>` is required on every command except `init` (see [The review database](#the-review-database-and---db)).

### Start a review

**`init`**: creates the review database. Creates the SQLite database that holds the review (findings, rounds, links) and, later, the downloaded pull request. It never replaces an existing database or report file. The report (markdown) is written next to the database (`<stem>`.md) and updated on every change.

```
pr-comments init <name> [--pr <url>] [--db <file.sqlite>]
pr-comments init "PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42
```

- `<name>`: what is under review; the title of the report (a slug of it names the files by default).
- `--pr <url>`: connect the review to this pull request.
- `--db <file.sqlite>`: the database (.sqlite) to create (default: .ai/review-with-docs/`<yyyy-mm-dd>`_`<slug of the name>`_review.sqlite at the git root).

### The pull request

**`pr connect`**: connects the review to its pull request. The same pull request again changes nothing. Another pull request is refused once the review has links to the comments of this one. Connecting the review to a different pull request drops the downloaded data of the old one; run "pr-comments pr sync --db `<file.sqlite>`" next.

```
pr-comments pr connect <url> --db <file.sqlite>
pr-comments pr connect https://github.com/acme/widgets/pull/42 --db review.sqlite
```

- `<url>`: the URL of the pull request.

**`pr show`**: shows the connected pull request and when it was synced. Prints the connected pull request and, when it was downloaded, when, its head commit and how much of it the database holds.

```
pr-comments pr show --db <file.sqlite>
pr-comments pr show --db review.sqlite
```

**`pr sync`**: downloads the connected pull request into the database. Downloads the comments, reviews, threads and check annotations of the connected pull request from GitHub and stores them in the database, replacing what the last sync stored. A comment that a link points at is kept, marked as gone, when GitHub no longer has it. Needs a token.

```
pr-comments pr sync --db <file.sqlite>
pr-comments pr sync --db review.sqlite
```

### Rounds

**`round open`**: opens a round (the revision reviewed and its base). Records a new round under Reviewed: the revision that is reviewed and the base it is compared with. A revision is anything git names a commit by (HEAD, a branch, a tag, an abbreviation); the review stores the short hash (at least 8 characters) of the commit.

```
pr-comments round open [--revision <rev>] (--base <rev> | --no-base) [--note <text>] --db <file.sqlite>
pr-comments round open --base origin/main --db review.sqlite
```

- `--revision <rev>`: the revision reviewed (default: HEAD).
- `--base <rev>`: the revision the round is compared with.
- `--no-base`: there is no base: the code is reviewed as it stands.
- `--note <text>`: a note for the round (placed on the Reviewed line after ";"), where the scope or other context of the review can be written, such as "scope: src/ only"

**`round update`**: adds a note to a round. Appends a note (such as "no findings" after an empty pass) to a round under Reviewed.

```
pr-comments round update <text> [--round <n>] --db <file.sqlite>
pr-comments round update "no findings" --db review.sqlite
```

- `<text>`: the note, one line.
- `--round <n>`: the round to update (default: the latest round).

### Findings

**`finding add`**: adds a finding. Adds a finding, opened by the update "Round `<n>`: raised" of the latest round, so a round must be open.

```
pr-comments finding add --severity <high|medium|low> --title <text> --description-file <file|-> [--unverified] [--note <text>] --db <file.sqlite>
pr-comments finding add --severity high --title "Missing timeout" --description-file description.md --db review.sqlite
```

- `--severity <high|medium|low>`: the severity.
- `--title <text>`: the title, one line.
- `--description-file <file|->`: the description, read from a UTF-8 file or from standard input (-).
- `--unverified`: open the finding as unverified instead of awaiting triage.
- `--note <text>`: a note for the opening update.

**`finding list`**: lists the findings. Lists the findings of the review, one line each, and how many of them there are. The criteria are anded.

```
pr-comments finding list [--state <state>] [--severity <severity>] [--unposted] --db <file.sqlite>
pr-comments finding list --state approved --unposted --db review.sqlite
```

- `--state <state>`: only findings in this state: awaiting, unverified, approved, fixed, discarded, deferred or improvement.
- `--severity <severity>`: only findings of this severity: high, medium or low.
- `--unposted`: only findings that have no comment of their own on the pull request yet.

**`finding show`**: shows one finding with its updates. Prints the finding, the comments linked to it (such as "Linked: own r544861, duplicate r544900"), the description and its Updates.

```
pr-comments finding show <finding> --db <file.sqlite>
pr-comments finding show F7 --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).

**`finding set-state`**: moves a finding to another state. Moves the finding to another state (any state except the one it is already in). A change is logged under the Updates of the finding, with the time. The state fixed needs the revision that fixes it. A revision is anything git names a commit by (HEAD, a branch, a tag, an abbreviation); the review stores the short hash (at least 8 characters) of the commit.

```
pr-comments finding set-state <finding> <state> [--revision <rev>] [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-state F7 fixed --revision HEAD --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<state>`: awaiting, unverified, approved, fixed, discarded, deferred or improvement.
- `--revision <rev>`: the revision the change is about.
- `--note <text>`: why.
- `--round <n>`: write "Round `<n>`: " at the start of the Updates entry (a round that was opened).

**`finding set-severity`**: changes the severity of a finding. Changes the severity of the finding. A change is logged under the Updates of the finding, with the time.

```
pr-comments finding set-severity <finding> <severity> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-severity F7 medium --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<severity>`: high, medium or low.
- `--note <text>`: why.
- `--round <n>`: write "Round `<n>`: " at the start of the Updates entry (a round that was opened).

**`finding set-title`**: changes the title of a finding. Changes the title of the finding. A change is logged under the Updates of the finding, with the time.

```
pr-comments finding set-title <finding> <title> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-title F7 "Missing retry timeout" --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<title>`: the new title, one line.
- `--note <text>`: why.
- `--round <n>`: write "Round `<n>`: " at the start of the Updates entry (a round that was opened).

**`finding set-description`**: replaces the description of a finding. Replaces the description of the finding with the new text (the description always holds the latest version). A change is logged under the Updates of the finding, with the time.

```
pr-comments finding set-description <finding> --description-file <file|-> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-description F7 --description-file - --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `--description-file <file|->`: the new description, read from a UTF-8 file or from standard input (-).
- `--note <text>`: why.
- `--round <n>`: write "Round `<n>`: " at the start of the Updates entry (a round that was opened).

**`finding update`**: adds an update to a finding. Adds a free-form entry to the Updates of the finding: a question, a verdict, a note.

```
pr-comments finding update <finding> <text> [--round <n>] --db <file.sqlite>
pr-comments finding update F7 "Asked the author" --round 1 --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<text>`: the update.
- `--round <n>`: write "Round `<n>`: " at the start of the Updates entry (a round that was opened).

**`finding post`**: publishes the comment of a finding. Publishes the comment of one finding, in any state, to the connected pull request (to your pending review unless --now) and links it to the finding as its own comment. Run again, it updates that comment. Without --dry-run the returned comment ref and link are recorded in the database; run "pr-comments pr sync --db `<file.sqlite>`" to refresh the full pull request snapshot. Needs a token with write permission.

```
pr-comments finding post <finding> [--anchor <n>] [--commit <sha>] [--by-agent] [--now] [--dry-run] --db <file.sqlite>
pr-comments finding post F7 --dry-run --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `--anchor <n>`: use the n-th path:lines anchor of the description (default: 1).
- `--commit <sha>`: pin the comment to this commit, 7-40 hex digits (default: the head of the pull request).
- `--by-agent`: start the comment with a line saying an agent wrote it.
- `--now`: publish immediately instead of adding to your pending review.
- `--dry-run`: check everything and say what would happen, without writing anything.
- The comment is `<severity> **<id> — <title>**` and the description (e.g. `🔴 **F7 — Missing timeout**`). Only the description goes to GitHub, never the Updates; relative links pointing into the review are replaced by their text.
- The place is the first `` `path:lines` `` anchor of the description (`--anchor <n>` picks another; a whole-file finding uses `path:1` when line 1 is in the diff).
- `--now` publishes at once (not possible while you have a pending review); `--commit <sha>` pins the comment when no pending review exists yet.
- The exit code is 1 when the result is an error.

### Links

A link ties a comment or a check annotation of the pull request to the review. Its role is `own` (the comment of a finding, at most one per finding), `duplicate` (the same issue as a finding, any number) or `note` (a comment that is no finding, with the reason). A ref is linked once. Links are records in the database only. The refs must be in the downloaded pull request, so run `pr sync` first.

**`link pending`**: lists the comments and check annotations not linked yet. Prints one line per top-level comment or check annotation of the synced pull request that no link names: ref, author or app, place, state or level, and an excerpt. Nothing is printed when everything is processed (use "report comments" to inspect thread replies, edited comments, and submitted review bodies). Replies are not listed; their thread is the root comment. It exits with 0 whenever it ran: pending work is not a failure. Before the first "pr sync" it exits with 1.

```
pr-comments link pending --db <file.sqlite>
pr-comments link pending --db review.sqlite
```

**`link own`**: links a comment as the own comment of a finding. Links an existing comment of the pull request as the own comment of the finding (a finding has one), as if it had posted it.

```
pr-comments link own <finding> <ref> [--note <text>] --db <file.sqlite>
pr-comments link own F7 r544861 --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<ref>`: the comment: r544830 or c623843.
- `--note <text>`: why.

**`link duplicate`**: links a comment or check annotation about the same issue. Links a comment or a check annotation as a duplicate of the finding (a finding may have several).

```
pr-comments link duplicate <finding> <ref> [--note <text>] --db <file.sqlite>
pr-comments link duplicate F7 c623843 --db review.sqlite
```

- `<finding>`: the finding, such as F7 (any case).
- `<ref>`: the comment or check annotation: r544830, c623843 or a3f9c2d1e.
- `--note <text>`: why.

**`link note`**: records that a comment is not a finding, and why. Records that the comment is no finding, with the reason. A check annotation cannot be a note.

```
pr-comments link note <ref> <text> --db <file.sqlite>
pr-comments link note c623843 "a bot, not a finding" --db review.sqlite
```

- `<ref>`: the comment: r544830 or c623843.
- `<text>`: the reason, one line.

**`link remove`**: removes the link of a comment or check annotation. Removes the link of the comment, whatever its role; the comment is pending again.

```
pr-comments link remove <ref> [--note <text>] --db <file.sqlite>
pr-comments link remove r544861 --db review.sqlite
```

- `<ref>`: the comment or check annotation: r544830, c623843 or a3f9c2d1e.
- `--note <text>`: why.

**`link reply`**: answers a duplicate with "Duplicate of `<link>`." Answers a comment that is linked as a duplicate of a finding with "Duplicate of `<link to the own comment of the finding>`." in your pending review, and records the returned reply ref and update in the database (run "pr-comments pr sync --db `<file.sqlite>`" to refresh the full pull request snapshot). The finding must have an own comment. Needs a token with write permission. A conversation comment can only be answered at once, so it needs --now. The thread is never resolved by the tool.

```
pr-comments link reply <ref> [--by-agent] [--now] [--dry-run] --db <file.sqlite>
pr-comments link reply c623843 --dry-run --db review.sqlite
```

- `<ref>`: the comment that is linked as a duplicate: r544830 or c623843.
- `--by-agent`: start the comment with a line saying an agent wrote it.
- `--now`: publish immediately instead of adding to your pending review.
- `--dry-run`: check everything and say what would happen, without writing anything.
- A reply in a review thread always goes into your pending review; `--now` has no effect on it.
- A conversation comment (`c…`) has no thread and is answered with a new conversation comment visible at once, so it needs `--now`.
- The output says whether the thread is open or resolved, as information only. A rerun does not reply twice. The exit code is 1 when the result is an error.

### Reports

**`report render`**: writes the review report. Writes the markdown report of the review, made from the database, and says whether the file was created, updated or left unchanged. It overwrites the report each time (change the review with the commands, never in the markdown). It writes the report only, never the database, and never over a SQLite file.

```
pr-comments report render --db <file.sqlite>
pr-comments report render --db review.sqlite
```

**`report comments`**: writes the pull request conversation as markdown. Writes the downloaded pull request (reviews, threads, comments and the Checks section) as markdown, to the screen unless --out is given. Run "pr-comments pr sync --db `<file.sqlite>`" first.

```
pr-comments report comments [--ref <ref>]... [--pending] [--out <file.md>] --db <file.sqlite>
pr-comments report comments --pending --out pr-42.md --db review.sqlite
```

- `--ref <ref>`: only these comments or check annotations (several refs comma-separated); a review comment includes its thread; may be repeated.
- `--pending`: only comments and check annotations that no link names yet.
- `--out <file.md>`: write the markdown to this file.
- With `--ref` or `--pending`, review bodies are not shown. An unknown `--ref` gives a warning, and a malformed ref is an error.
- On Windows PowerShell prefer `--out` to `>`, because `>` writes UTF-16.

### Help and version

**`help`**: prints the help of a command or of a group. Prints the overview of the commands; or the commands of a group, such as "finding"; or the help of one command. "pr-comments `<command>` --help" prints the same.

```
pr-comments --help
pr-comments help [<command>]
pr-comments <group>             e.g. pr-comments finding
pr-comments <command> --help
pr-comments --version
```
<!-- END GENERATED COMMAND REFERENCE -->

## Concepts

### States and severities

A finding has a state and a severity. The report shows them as markers. In commands you write the name (the first word is enough, any case) or the marker.

| Marker | `--state` / `<state>` | Meaning |
| --- | --- | --- |
| ⏳ | `awaiting` | Awaiting triage: raised, not decided yet |
| ❓ | `unverified` | Evidence tried and unsettled; the user's call |
| ✅ | `approved` | The user agreed it is a finding |
| 🔧 | `fixed` | The code now addresses it; needs `--revision`, the revision that fixes it |
| ❌ | `discarded` | Not a finding; the reason is in the Updates |
| 📌 | `deferred` | Valid, consciously left as it is |
| 🔀 | `improvement` | Valid, handled outside this pull request |

| Marker | Severity |
| --- | --- |
| 🔴 | `high` |
| 🟡 | `medium` |
| ⚪ | `low` |

Any state can follow any other. A resolved thread on GitHub does not change a finding.

### Ids

| Id | What it is | Where it comes from |
| --- | --- | --- |
| `F7` | A finding of the review | The next free number. Never reused. Any case on input |
| `r544830` | A review comment (inline or on a file) | The number in the comment's link: `#discussion_r544830` |
| `c623843` | A conversation comment | `#issuecomment-623843` |
| `a3f9c2d1e` | A check annotation | `a` and 8 hex digits, computed from the app, the path, the lines and the message |

Check annotations are the "Check failure on line 132" items that tools such as SonarQube publish through the Checks API. They are not comments and have no id on GitHub, so the tool makes one. The same issue in unchanged code gets the same id. Only the check runs of the head commit that have annotations are read.

The GitHub web UI cannot search a comment by id, so the Updates of the report show every comment id as a link to the comment, for example `PR comment [r544861](https://github.com/acme/widgets/pull/42#discussion_r544861) linked as its own`. A check annotation has no URL and stays a bare id. Entries written by an earlier version keep bare ids.

### Revisions

`round open --revision` and `--base`, and `finding set-state … --revision` take anything git names a commit by: `HEAD`, a branch, a tag, an abbreviation, `HEAD~1`. The tool resolves it with git in the working directory and stores the short lower-case hash (at least 8 characters, longer when git needs more to disambiguate), never what you typed. An unknown revision, or no git repository, is an error. (`finding post --commit` is different: it takes 7 to 40 hex digits, and GitHub resolves it.)

### The review database and `--db`

- Every command except `init` works on an existing review database. A missing file is an error, and nothing is created.
- `--db <file.sqlite>` is required on every command except `init`. The name must end in `.sqlite`.
- A command that changes the database prints `Review database: <path>` on stderr after it succeeded, so you can see which review it changed. A dry run does not, and neither does `pr connect` to the pull request the review is already connected to.
- `init` uses `--db` to name the file it creates, defaulting to `.ai/review-with-docs/<yyyy-mm-dd>_<slug>_review.sqlite` at the git root.
- Several commands at once are safe: they wait for each other, up to 10 seconds. The read commands (`finding list`, `finding show`, `link pending`, `pr show`, and the `report` commands) open the file read-only and change nothing in it.

### Strict arguments and help

- An unknown option, an option that the command does not take, an option given twice, a missing or an extra argument: each is an error with one line that says what is wrong, and that command's usage. Never the whole help.

  ```
  pr-comments finding list --bogus
  unknown option --bogus
  Usage: pr-comments finding list [--state <state>] [--severity <severity>] [--unposted] --db <file.sqlite>
  Run "pr-comments finding list --help" for details.
  ```

- On a group line (`pr-comments finding --db x.sqlite`) an option error names the group and ends with `Run "pr-comments <group> --help" for the commands of the group.` instead of a usage line; on an empty command line an option error (or a valid option with no command) ends with `Run "pr-comments help" for the commands.`.
- A text that starts with `-` is written after `--` (put options such as `--db` before `--`).
- `--help` works on every command and group. It prints to stdout and exits with 0.
- Errors exit with 1. Pending work in `link pending` is not an error.
- Text, from a file or an argument, must not contain control characters other than tab and newline.

## Git

By default `init` puts reviews in `.ai/review-with-docs/` (excluded via `.git/info/exclude`, while `.ai/` itself can be versioned), so they stay out of Git commits; pass `--db` to keep one elsewhere, for example in a session folder.

- The database is one file. A `-journal` file exists only while a command writes.

## Development

```
pnpm test        # vitest, offline
pnpm typecheck   # tsc --noEmit
pnpm build       # ../../skills/review-with-docs/pr-comments.mjs
```

The schema, the ids, the GitHub behaviours learnt from live tests, the tokens, the report format, the build and the tests are described in [docs/technical.md](docs/technical.md).
