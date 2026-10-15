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

`pr sync` downloads the PR into the database — comments, reviews, threads,
check annotations. Run it after every push and before every publish.
`link pending` then lists each comment and check annotation that no link names
yet; empty output means every one is handled. Classify each line and record it
with a link:

| The comment or annotation | Command |
|---|---|
| a comment the user wrote by hand saying what a finding says | `link own <F> <ref>` |
| the same issue as a finding | `link duplicate <F> <ref>` |
| no finding | `link note <ref> '<reason>'` |
| a new issue | `finding add`, then `link duplicate <F> <ref>` |
| a check annotation, always | `link duplicate <F> <ref>` |

Links are records in the database; nothing reaches GitHub. A doubtful
classification is the user's call ([SKILL.md](SKILL.md)); `link remove <ref>`
undoes a link.

`report comments [--author <login>]...` prints the PR as markdown for reading
— description, conversation, threads with code, annotations. `--out <file>`
writes it to a file, which stays out of the review's commit unless the user
says otherwise.

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
4. A comment that duplicates a finding is answered with `link reply <ref>
   --by-agent`, with a dry run first before a `--now` reply. The reply goes
   into the same pending review. A conversation comment (`c…`) can only be
   answered at once, and its answer links to a comment that others cannot open
   before the submit: answer it after the user has submitted the review.

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
user, and the agent acts on the answer. Re-anchoring, `--commit`, or a
rewritten description are the ways past it; the user picks.

The other refusals — a missing token, a pending review that blocks `--now`, a
gone own comment — carry their fix in the message; follow it, and whatever it
asks that changes GitHub is the user's call.
