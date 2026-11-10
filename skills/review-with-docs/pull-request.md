# Pull request

Reached when the target is a pull request: reading what others wrote,
publishing findings, answering duplicates. Only `finding post` and `link
reply` write to GitHub; `pr sync` reads.

## Connect

`pr show` tells whether the review is connected. `init --pr <url>`
connects it at the start; `pr connect <url>` later, where the PR did not
exist yet. `pr sync`, `finding post` (dry runs too), and `link reply` need a
token, and the last two need write permission. The tool reads tokens from the
user's token files or environment, so their values never pass through the
conversation; where one is missing, the error names the file to create — ask
the user to create it.

## Read what others wrote

`pr sync` downloads the PR into the database — comments, reviews, threads,
check annotations. Run it after every push and before every publish.
`link pending` then lists each top-level comment and check annotation that no
link names yet; empty output means every one is handled. Read the full pending
threads and annotations with `report comments --pending` — when the fleet
threshold below is met, the parallel agents read them instead — then classify
each comment (replies included) and annotation and record it from the
orchestrator:

| The comment or annotation | Command |
|---|---|
| a comment the user wrote by hand saying what a finding says | `link own <F> <ref>` |
| the same concern as a finding | `link duplicate <F> <ref>` |
| counter-evidence on a finding | `finding update <F> '<ref>: <counter-evidence>'`, then `link note <ref> 'counter-evidence recorded on <F>'` |
| chatter or a status comment that raises no concern | `link note <ref> '<reason>'` |
| a concern no finding covers yet | `finding add`, then `link duplicate <F> <ref>` |
| a check annotation, always | `link duplicate <F> <ref>` |

Links are records in the database; nothing reaches GitHub. A note attaches to
no finding and leaves no trace in the report, so every comment that raises a
concern on the changeset — even one the agent refutes or that collides with a
rule — goes to a finding (with the counter-evidence recorded there) for the
user to triage. `link remove <ref>` undoes a link. `reopen <F>` (`--round <n>`)
and `finding add` record against the open round `<n>` — open step 7's round
first when a sync triggers a re-review round in step 7 ([SKILL.md](SKILL.md)),
or use the current round during step 4 or step 6.

Whenever there are more than 10 pending items, when the review already carries
more than 30 findings, or when `pending items × existing findings > 150`,
slice the refs across parallel **PR-comment agents** (~10–15 threads/items per
agent, keeping each thread's refs in one slice), each dispatched with its
`model` per [fleet.md](fleet.md). Each brief carries:

- the shared brief of [fleet.md](fleet.md);
- the command
  `node <skill-dir>/pr-comments.mjs report comments --ref <slice> --db <file.sqlite>`,
  run in the reviewed repository;
- the findings the review carries (listed as in the Later rounds of
  [fleet.md](fleet.md) up to 30 findings; when the review exceeds 30 findings,
  let the agent read existing findings via `finding list` and `finding show`
  with `--db <file.sqlite>` rather than pasting every finding's full
  description into every brief), the user's login, and the table and the
  paragraph after it;
- the output: a description file
  (`<report-stem>/round-<n>/pr-comments/<item-ref>.md` per
  [fleet.md](fleet.md)) for each concern no finding covers yet;
- the reply: classify every comment (replies included) and annotation in its
  slice for the orchestrator to record, naming the classified `<item-ref>`
  first on every line — `<item-ref> | own <target>`,
  `<item-ref> | duplicate <target>`,
  `<item-ref> | counter-evidence <target> '<counter-evidence>'`,
  `<item-ref> | note '<reason>'`, or `<item-ref> | <new-finding reply line>`
  ([fleet.md](fleet.md)) for `pr-comments/<item-ref>.md` — where `<target>` is
  either an existing `<F>` or `pr-comments/<ref>.md` in the slice (the
  `<item-ref>` of `pr-comments/<item-ref>.md` defaults to `duplicate`, or adds
  `<item-ref> | own pr-comments/<item-ref>.md` when the user wrote it by hand).

When `PR-comment` slices emit `pr-comments/<ref>.md` files, resolve them before
recording findings and links. Whenever multiple slices emit
`pr-comments/<ref>.md` files or [fleet.md](fleet.md)'s deduplication threshold
holds (`> 10` candidate files, or `> 30` existing findings in `finding list`
where `PR-comment` slices did not receive full finding descriptions in their
briefs), run the deduplication pass from [fleet.md](fleet.md) across those
candidate files. Below that threshold with a single slice emitting
`pr-comments/<ref>.md` files, apply the same merging, filtering, and
closed-finding gate ([fleet.md](fleet.md), Merging; step 7 of
[SKILL.md](SKILL.md)) directly before `finding add`. Either way, preserve a
complete map from every input `pr-comments/<ref>.md` (so every `<item-ref>`
routed to `pr-comments/<ref>.md` follows it) to its target:

1. **A surviving `new` file** (`pr-comments/<ref>.md` or `merged/<slug>.md`):
   once `finding add` assigns `<F>` to that surviving file in the open round
   `<n>`, every input `pr-comments/<ref>.md` mapped to it resolves to `<F>`.
2. **An existing finding `<F>`** (covered by an open ⏳ ❓ ✅ or 🔧 fixed
   finding, reopening a regressed 🔧 fixed or qualifying closed ❌ 📌 🔀
   finding via `reopen <F> [<file>]`, or covered by a closed finding ❌ 📌 🔀
   whose ruling stands under the closed-finding gate): apply any qualifying
   `reopen <F>` (`--round <n>`) first per step 4 / step 7 of
   [SKILL.md](SKILL.md) (or surface it as the user's call when ambiguous), and
   resolve every input `pr-comments/<ref>.md` mapped to it to `<F>`.

Once any `pr-comments/<ref>.md` files resolve to `<F>`, record each
`<item-ref>` (the file's own `<ref>` and every `<item-ref>` routed to
`pr-comments/<ref>.md`, alongside items classified directly against existing
findings) against `<F>` (`link own <F> <item-ref>` when `<item-ref>` was the
user's own hand-written comment and `<F>` has no own comment yet,
`finding update <F> '<item-ref>: <counter-evidence>'` plus
`link note <item-ref> 'counter-evidence recorded on <F>'` for
`counter-evidence`, and `link duplicate <F> <item-ref>` otherwise — recording
`finding update <F>` too where a comment mapped to an existing `<F>` brought
counter-evidence without reopening it), and record `note` items with
`link note <item-ref> '<reason>'`, leaving `link pending` empty.

## Publish

1. `finding list --state approved --unposted` lists the approved findings that
   have no comment of their own yet. The tool posts a finding in any state, so
   the filter does the selecting: a finding in another state, one fixed after
   its approval for example, goes out as the user's call.
2. A dry run comes first where a mistake is costly or likely: `--now`, a
   finding without an anchor, a whole-file anchor on a modified file, a
   description with relative links, and the first post of a session.
   `finding post <F> --dry-run --by-agent` writes nothing and prints the exact
   text and the place. Check the anchor, the warnings, and `links removed`.
3. `finding post <F> --by-agent` adds the comment to the user's **pending
   review**, which nobody else sees. The tool never submits it: tell the user
   the comments wait for their submit in the web UI. Any other post goes
   straight here: the post checks the place before it writes, and the comment
   stays unseen until that submit.
4. A comment that duplicates a finding is answered only on the user's request,
   with `link reply <ref> --by-agent` and a dry run first before a `--now`
   reply. The reply goes into the same pending review. A conversation comment
   (`c…`) can only be answered at once, and its answer links to a comment that
   others cannot open before the submit: answer it after the user has
   submitted the review.

`--by-agent` goes on every post and reply, dry runs included, so the preview
is the exact text. `--now` publishes at once, and a conversation comment (`c…`)
or a finding without an anchor can only go that way: `--now` is
the user's call, since an immediate comment cannot be taken back with the
pending review. Posting an already posted finding again edits its live
comment: re-posting is the user's call too.

## A refused post

A comment lands on the PR's latest revision, and the reviewed checkout may
have diverged from it. A refusal is the signal, and the user's call: the
message, the finding, and the commentable ranges the message lists go to the
user, and the agent acts on the answer. Re-anchoring, a rewritten
description, or `--commit` (only before the user has a pending review) are
the ways past it; the user picks.

The other refusals — a pending review that blocks `--now`, a gone own
comment — carry their fix in the message; follow it, and whatever it asks that
changes GitHub is the user's call.
