# Pull request

Reached when the target is a pull request: reading what others wrote,
publishing findings, answering duplicates. Only `finding post` and `link
reply` write to GitHub; `pr sync` reads.

## Connect

`pr show --json` tells whether the review is connected. `init --pr <url>`
connects it at the start; `pr connect <url>` later, where the PR did not
exist yet. `pr sync`, `finding post` (dry runs too), and `link reply` need a
token, and the last two need write permission. The tool reads tokens from the
user's token files or environment, so their values never pass through the
conversation; where one is missing, the error names the file to create — ask
the user to create it.

## Read what others wrote

A **verdict marker** is `<review-url> (<timestamp>)`: the `[link]` URL and the
`edited` (or submit) timestamp that `report comments` prints for a submitted
review. An **edited-comment marker** is `<ref> edited <timestamp>`: the
comment's ref and the `edited` timestamp in its `report comments` header.

`pr sync` downloads the PR into the database — comments, reviews, threads,
check annotations. Run it after every push and before every publish.
`link pending` then lists each top-level comment and check annotation that no
link names yet; empty output means every top-level item is linked. Read the
full pending threads and annotations with `report comments --pending`, and
read unfiltered `report comments` for nonempty submitted review verdict bodies
whose verdict marker does not yet appear in `report dump` and, on a re-sync,
for unlinked replies in already linked threads and for already linked comments
whose edited-comment marker does not yet appear in `report dump` (`report
dump` lists every linked ref, note, and finding update). Then classify each
item and record it from the orchestrator:

| The comment, annotation, or review verdict body | Command |
|---|---|
| a comment the user wrote by hand saying what a finding says | `link own <F> <ref>` |
| the same concern as a finding | `link duplicate <F> <ref>` |
| counter-evidence on a finding | `finding update <F> '<ref>: <counter-evidence>'`, then `link note <ref> 'counter-evidence recorded on <F>'` |
| chatter or a status comment that raises no concern | `link note <ref> '<reason>'` |
| a concern no finding covers yet | `finding add`, then `link duplicate <F> <ref>` |
| a check annotation, always | `link duplicate <F> <ref>` |
| a review verdict body repeating a finding, written by the user as that finding, or giving counter-evidence on it | `finding update <F> '<verdict-marker>: <text>'` |
| a review verdict body raising a concern no finding covers yet | `finding add --note '<verdict-marker>'` |

Links are records in the database; nothing reaches GitHub. A note attaches to
no finding and leaves no trace in the report, so every comment or review
verdict body that raises a concern on the changeset — even one the agent
refutes or that collides with a rule — goes to a finding (with the
counter-evidence recorded there) for the user to triage. `link remove <ref>`
undoes a link; every record of a comment whose header shows `edited` carries
its edited-comment marker in `--note`, the `link note` reason, or the `finding
update` text (run `link remove <ref>` first when the comment is already
linked).

Past a handful of refs to read, the orchestrator reads the review verdict
bodies and slices the pending, linked-thread, and edited linked refs across
parallel agents (each given its model, the shared brief, and the read-only
contract per [fleet.md](fleet.md)) that run
`node <skill-dir>/pr-comments.mjs report comments --ref <slice> --db <file.sqlite>`
in the reviewed repository, read the comments against the findings the review
carries (listed as in the Later rounds of [fleet.md](fleet.md)), the already
linked refs, the user's login, the edited-comment marker definition, and the
table and the paragraph above, write a description file per [fleet.md](fleet.md)
for each concern no finding covers yet, a refuted one included, and reply with
one classification per pending, unlinked-reply, or edited linked ref
(`own <F>`, `duplicate <F>`, `counter-evidence <F> '<counter-evidence>'`,
`note '<reason>'`, or the new finding's reply line per [fleet.md](fleet.md)),
plus its edited-comment marker where its header shows `edited`, for the
orchestrator to record.

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
