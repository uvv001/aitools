# pr-comments

`pr-comments` keeps the code review of one GitHub pull request in one SQLite file.

The file holds the findings, the rounds, the links from findings to comments, and the downloaded pull request itself. The tool publishes findings as comments into your pending review, and it renders markdown reports. It uses the GitHub API of github.com and of GitHub Enterprise Server. The live tests so far ran against Enterprise Server.

It is made for a person or an AI agent that reviews a pull request. The commands print short lines, and every command has `--help`.

Technical details (schema, ids, GitHub behaviours, tokens) are in [docs/technical.md](docs/technical.md).

## Install

You need Node 24.2 or newer, and pnpm.

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

The bundle needs only Node 24.2: no `node_modules`, no installation. It behaves exactly like the global command. `--version` shows the version and, for a bundle, the commit it was built from (`pr-comments 0.1.0+75c05c9`, with `-dirty` when the sources had uncommitted changes).

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

Both the database and the report are created, and every change updates the report after the database change commits (if writing the report file fails afterwards, the database change stays saved, the command exits `0`, and `stderr` prints `Warning: the report <report> was not refreshed (<reason>); run "pr-comments report render --db <db>"`). Without `--report` or `--db`, the files go to `.ai/review-with-docs/<yyyy-mm-dd>_<name as a slug>_review.{md,sqlite}` at the git root; whenever `init` places a review under `.ai/review-with-docs/` (subfolders included), it checks with `git check-ignore`, adds `/.ai/review-with-docs/` to `.git/info/exclude` when not already ignored (while `.ai/` itself can remain versioned), and fails if a `.gitignore` rule still exposes the folder. Pass `--db <session-folder>/files/review-with-docs/<yyyy-mm-dd>_<slug>_review.sqlite` when storing the review in a session folder. Every subsequent command takes `--db <file.sqlite>` (`$DB` below). If the pull request does not exist yet, leave out `--pr`, and connect it later:

```
pr-comments pr connect https://github.com/acme/widgets/pull/42 --db $DB
Connected to https://github.com/acme/widgets/pull/42
```

**2. Open a round.** A round is one pass over a revision, compared with a base. `--note` is optional: write the scope of the review (or any other context) there. It goes onto the Reviewed line of the report.

```
pr-comments round open --base origin/main --note "scope: src/tenants only" --db $DB
Round 1 opened
```

The revision is `HEAD` unless you say `--revision`. The tool stores the 8-character hash of the commit.

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

**6. Deal with what others wrote.** `link pending` is the to-do list. It prints every comment and every check annotation of the pull request that no link names yet.

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

When `link pending` prints nothing, every comment and annotation is handled. Empty output is the answer. The exit code is 0 whether it printed something or not, so pending work is never a failure. (Before the first `pr sync` it is an error instead.) Replies are not listed: their thread is the first comment.

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
pr-comments report comments --author bob --out .ai/review-with-docs/pr-42_comments.md --db $DB
Wrote .ai/review-with-docs/pr-42_comments.md
```

`report render` writes the review report next to the database, and prints `created`, `updated` or `unchanged` and the path. `report comments` writes the pull request as markdown (description, reviews, threads, check annotations), to the screen or to a file.

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

Every command also has `pr-comments <command> --help` (or `pr-comments help <command>`) with its options, and an example. This section does not repeat every option. `--db <file.sqlite>` is required on every command except `init` (see [The review database](#the-review-database-and---db)).

### Start a review

**`init`**: creates the review database. It never replaces an existing database or report file.

```
pr-comments init <name> [--pr <url>] [--report <file.md>] [--db <file.sqlite>]
pr-comments init "PR 42 tenant registry" --pr https://github.com/acme/widgets/pull/42
```

- `--pr <url>` connects the review to a pull request.
- `--report <file.md>` names the report. The database is created next to it, with the same name and `.sqlite`. A `.sqlite` path works too.
- `--db <file.sqlite>` puts the database somewhere else (and the report next to it).

### The pull request

**`pr connect`**: connects the review to its pull request. The same pull request again changes nothing. Another one is refused once links exist.

```
pr-comments pr connect <url> --db <file.sqlite>
pr-comments pr connect https://github.com/acme/widgets/pull/42 --db $DB
```

**`pr show`**: shows the connected pull request, when it was synced, its head commit, and how much of it the database holds. `--json` prints the same as JSON.

```
pr-comments pr show [--json] --db <file.sqlite>
pr-comments pr show --db $DB
```

**`pr sync`**: downloads the connected pull request into the database. A comment that a link names stays in the database, marked as gone, when GitHub no longer has it. Needs a token.

```
pr-comments pr sync --db <file.sqlite>
pr-comments pr sync --db $DB
```

### Rounds

**`round open`**: opens a round: the revision reviewed and the base it is compared with.

```
pr-comments round open [--revision <rev>] (--base <rev> | --no-base) [--note <text>] --db <file.sqlite>
pr-comments round open --base origin/main --note "scope: src/tenants only" --db $DB
```

- `--revision <rev>` is `HEAD` by default.
- Give `--base <rev>` or `--no-base` (the code is reviewed as it stands).
- `--note <text>` is where the scope or other context of the review is written. It goes onto the Reviewed line of the report, after a `;`.

**`round update`**: adds a note (such as `no findings`) to a round under **Reviewed**.

```
pr-comments round update <text> [--round <n>] --db <file.sqlite>
pr-comments round update "no findings" --db $DB
```

- `--round <n>` updates that round instead of the latest one.

### Findings

**`finding add`**: adds a finding. A round must be open. It prints `Added F7`, or with `--json` the object `{ "id": "F7" }`.

```
pr-comments finding add --severity <high|medium|low> --title <text> --description-file <file|-> [--unverified] [--note <text>] [--json] --db <file.sqlite>
pr-comments finding add --severity high --title "Missing timeout" --description-file description.md --db $DB
```

- `--description-file -` reads standard input. The file must be UTF-8.
- `--unverified` opens the finding as ❓ unverified instead of ⏳ awaiting triage.

**`finding list`**: one line per finding, then how many there are. The options are combined with "and".

```
pr-comments finding list [--state <state>] [--severity <severity>] [--unposted] [--json] --db <file.sqlite>
pr-comments finding list --state approved --unposted --db $DB
```

- `--state` takes one of the states below. `--severity` takes `high`, `medium` or `low`.
- `--unposted` keeps the findings that have no own comment on the pull request yet, in any state. Add `--state` for one state.

**`finding show`**: the finding, the comments linked to it (`Linked: own r544861, duplicate r544900`), the description, and the Updates. `--json` adds the evidence (the anchors) and the links.

```
pr-comments finding show <finding> [--json] --db <file.sqlite>
pr-comments finding show F7 --db $DB
```

**`finding set-state`**: moves a finding to another state. A finding can go to any state, except the one it is in.

```
pr-comments finding set-state <finding> <state> [--revision <rev>] [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-state F7 fixed --revision HEAD --db $DB
```

- `fixed` needs `--revision`.
- `--note` says why. `--round <n>` starts the Updates entry with `Round <n>: `. The round must have been opened.

**`finding set-severity`**, **`set-title`**, **`set-description`**: change the severity, the title and the description. Each logs an Updates entry. The description always holds the latest version.

```
pr-comments finding set-severity <finding> <severity> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-title <finding> <title> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-description <finding> --description-file <file|-> [--note <text>] [--round <n>] --db <file.sqlite>
pr-comments finding set-severity F7 medium --db $DB
pr-comments finding set-title F7 "Missing retry timeout" --db $DB
pr-comments finding set-description F7 --description-file - --db $DB
```

**`finding update`**: adds a free-form entry to the Updates: a question, a verdict, a note.

```
pr-comments finding update <finding> <text> [--round <n>] --db <file.sqlite>
pr-comments finding update F7 "Asked the author" --round 1 --db $DB
```

**`finding post`**: publishes the comment of a finding, in any state, to the connected pull request, and links it to the finding as its own comment. Run again, it updates that comment. Needs a token with write permission.

```
pr-comments finding post <finding> [--anchor <n>] [--commit <sha>] [--by-agent] [--now] [--dry-run] [--json] --db <file.sqlite>
pr-comments finding post F7 --dry-run --db $DB
```

- The comment is `<severity> **<id> — <title>**` and the description, e.g. `🔴 **F7 — Missing timeout**`. The id is the one of the review document, so a person can match the comment with the finding. It is local to the review: the pull request author does not know it. A comment posted before the id was added is updated with it by running `finding post` again (it counts as an update). Only the description goes to GitHub, never the Updates. Links in it that point into the review (relative links) are replaced by their text.
- The place is the first `` `path:lines` `` anchor of the description. `--anchor <n>` takes another one. A finding about a whole file is anchored at `path:1`. That works when line 1 is part of the pull request diff (it is for every file the pull request adds).
- It goes to your pending review. `--now` publishes at once (not possible while you have a pending review).
- `--commit <sha>` pins the comment to a commit (only when no pending review exists yet).
- `--by-agent` starts the comment with a line that says an agent wrote it. `--dry-run` writes nothing. `--json` prints the result, the anchors and the text.
- The exit code is 1 when the result is an error.

### Links

A link ties a comment or a check annotation of the pull request to the review. Its role is `own` (the comment of a finding, at most one per finding), `duplicate` (the same issue as a finding, any number) or `note` (a comment that is no finding, with the reason). A ref is linked once. Links are records in the database only. The refs must be in the downloaded pull request, so run `pr sync` first.

**`link pending`**: the to-do list. One line per comment or check annotation that no link names (ref, author or app, place, state or level, excerpt). Nothing is printed when everything is handled. It exits with 0 whenever it ran. Before the first `pr sync` there is nothing to list, and it is an error (exit 1). `--json` prints an array (`[]` when none).

```
pr-comments link pending [--json] --db <file.sqlite>
pr-comments link pending --db $DB
```

**`link own`**: links an existing comment as the own comment of a finding (as if the tool had posted it).

```
pr-comments link own <finding> <ref> [--note <text>] --db <file.sqlite>
pr-comments link own F7 r544861 --db $DB
```

**`link duplicate`**: links a comment or a check annotation about the same issue as the finding.

```
pr-comments link duplicate <finding> <ref> [--note <text>] --db <file.sqlite>
pr-comments link duplicate F7 c623843 --db $DB
```

**`link note`**: records that a comment is no finding, and why. A check annotation cannot be a note.

```
pr-comments link note <ref> <text> --db <file.sqlite>
pr-comments link note c623843 "a bot, not a finding" --db $DB
```

**`link remove`**: removes the link, whatever its role. The comment is pending again.

```
pr-comments link remove <ref> [--note <text>] --db <file.sqlite>
pr-comments link remove r544861 --db $DB
```

**`link reply`**: answers a comment that is linked as a duplicate with `Duplicate of <link to the own comment of the finding>.` The finding must have an own comment. Needs a token with write permission.

```
pr-comments link reply <ref> [--by-agent] [--now] [--dry-run] [--json] --db <file.sqlite>
pr-comments link reply c623843 --dry-run --db $DB
```

- A reply in a review thread always goes into your pending review. `--now` has no effect on it.
- A conversation comment (`c…`) has no thread. It can only be answered with a new conversation comment, which is visible at once, so it needs `--now`.
- The tool never resolves the thread. The output says whether it is open or resolved, as information only.
- A rerun does not reply twice.

### Reports

**`report render`**: writes the markdown report of the review, made from the database. It prints `created`, `updated` or `unchanged` and the path. It overwrites the report each time: change the review with the commands, never in the markdown. It never writes over a SQLite file.

```
pr-comments report render [--out <file.md>] --db <file.sqlite>
pr-comments report render --db $DB
```

The default file is next to the database (`<name>.md`). `--out` writes it elsewhere.

**`report comments`**: writes the downloaded pull request as markdown: the description, the conversation, the review threads with code, and the check annotations. It goes to the screen unless `--out` is given. Run `pr sync` first.

```
pr-comments report comments [--author <login>]... [--ref <ref>]... [--pending] [--out <file.md>] --db <file.sqlite>
pr-comments report comments --author alice --out pr-42.md --db $DB
```

`--author` and `--ref` may be repeated, or take a comma-separated list. `--author` keeps the comments and reviews of that user and the check runs of that app. `--ref` keeps only the listed comments (with their thread) and check annotations; an unknown ref gives a warning, and a malformed ref is an error. `--pending` keeps only comments and check annotations that no link names yet. With `--ref` or `--pending`, review bodies are not shown. On Windows PowerShell prefer `--out` to `>`, because `>` writes UTF-16.

**`report dump`**: prints the review as text, for `git diff` (see [Git](#git)). It lists the findings, the rounds, the links and the pull request URL, not the downloaded comments.

```
pr-comments report dump --db <file.sqlite>
pr-comments report dump --db $DB
```

### Help and version

```
pr-comments --help
pr-comments help [<command>]
pr-comments <group>             e.g. pr-comments finding
pr-comments <command> --help
pr-comments --version
```

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

`round open --revision` and `--base`, and `finding set-state … --revision` take anything git names a commit by: `HEAD`, a branch, a tag, an abbreviation, `HEAD~1`. The tool resolves it with git in the working directory and stores the 8-character lower-case hash, never what you typed. An unknown revision, or no git repository, is an error. (`finding post --commit` is different: it takes 7 to 40 hex digits, and GitHub resolves it.)

### The review database and `--db`

- Every command except `init` works on an existing review database. A missing file is an error, and nothing is created.
- `--db <file.sqlite>` is required on every command except `init`. The name must end in `.sqlite`.
- A command that changes the database prints `Review database: <path>` on stderr after it succeeded, so you can see which review it changed. A dry run does not, and neither does `pr connect` to the pull request the review is already connected to.
- `init` uses `--db` (or `--report`) to name the file it creates, defaulting to `.ai/review-with-docs/<yyyy-mm-dd>_<slug>_review.sqlite` at the git root.
- Several commands at once are safe: they wait for each other, up to 10 seconds. The read commands (`finding list`, `finding show`, `link pending`, `pr show`, and the `report` commands) open the file read-only and change nothing in it.

### Strict arguments, help, `--json`

- An unknown option, an option that the command does not take, an option given twice, a missing or an extra argument: each is an error with one line that says what is wrong, and that command's usage. Never the whole help.

  ```
  pr-comments finding list --bogus
  unknown option --bogus
  Usage: pr-comments finding list [--state <state>] [--severity <severity>] [--unposted] [--json] --db <file.sqlite>
  Run "pr-comments finding list --help" for details.
  ```

- A text that starts with `-` is written after `--`.
- `--help` works on every command and group. It prints to stdout and exits with 0.
- Errors exit with 1. Pending work in `link pending` is not an error.
- `--json` exists only where a program must act on the result: `finding add`, `finding list`, `finding show`, `finding post`, `link reply`, `link pending`, `pr show`. Anywhere else it is an error.
- Text, from a file or an argument, must not contain control characters other than tab and newline. A description must not contain a markdown heading outside a code block, or an unclosed code block, because it would break the report. The tool says so.

## Git

By default `init` puts reviews in `.ai/review-with-docs/` (excluded via `.git/info/exclude`, while `.ai/` itself can be versioned), so they stay out of Git commits; pass `--db` to keep one elsewhere, for example in a session folder. When `--report` or `--db` places a review in a tracked folder instead, commit the database next to the report.

The database is a binary file, so `git diff` cannot show what changed in it. `report dump` turns it into text. Tell git to use it:

```
# .gitattributes
*_review.sqlite diff=review
```

```
# once per clone
git config diff.review.textconv "pr-comments report dump --db"
```

`git diff`, `git log -p` and `git show` then show the dump of the old and the new database. Git adds the path of a temporary copy as the last argument, so the command that runs is `pr-comments report dump --db <copy>`.

- One writer at a time. A binary file cannot be merged. After a conflict, take one side (`git checkout --theirs <file>` or `--ours`) and redo the other changes with the commands.
- The repository that holds tracked databases must not git-ignore `*.sqlite`.
- The database is one file. A `-journal` file exists only while a command writes.

## Development

```
pnpm test        # vitest, offline
pnpm typecheck   # tsc --noEmit
pnpm build       # ../../skills/review-with-docs/pr-comments.mjs
```

The schema, the ids, the GitHub behaviours learnt from live tests, the tokens, the report format, the build and the tests are described in [docs/technical.md](docs/technical.md).
