# Recovery and edge cases

## Existing record or interrupted work

Reconcile previously open attempts with available artifacts; carry unresolved
ones forward. A task change in the same session updates the summary and adds a
transition entry. Re-invocation is idempotent for a confirmed session/workstream
binding; similarity of filenames or task descriptions is not ownership.

After an interruption, describe unfinished attempts as unresolved until evidence
arrives. Startup integration reactivates tracking on resumption. A fork or a new
independent session creates a separate record; updates occur while an agent has control.

If the workspace changes, re-establish the destination. Preserve the earlier
record unless the user requests moving it.

## Unclear ownership or parallel work

Keep one coordinating writer for a shared record. Give subagents the relevant
workspace and ask them to return milestones, outcomes, and artifact locations.
Record dispatch and report receipt separately; the receipt entry's prefix names
the reporting agent's model, and a first-time contributor joins the contributor
list.
Timestamp receipt as receipt; include a sourced completion time only when known.

If the requested file is an unrelated document or has another active writer,
leave it intact and select a distinct name using [naming.md](naming.md).
Reuse requires a confirmed handoff or explicit user direction, not a topic match.
Re-read changed content and integrate user edits.

## Git storage

Check both exclusion and index state: ignoring a path does not untrack it.
Reuse an existing rule covering root `.ai`. If one is absent, prefer the local
Git exclude file for automatic setup so unrelated tracked configuration stays
unchanged; locate it with `git rev-parse --git-path info/exclude` for worktree support.
Add `/.ai/` without replacing existing rules, then verify with `git check-ignore`.
A shared `.gitignore` rule is appropriate when repository-wide exclusion is requested.

Create new records at untracked paths. A tracked legacy record requires an
explicit migration decision; removing it from earlier commits requires separate
history-rewrite authorization. Automatic startup does not rewrite Git history.
Outside Git, use `.ai` without pretending an exclusion check was performed.

## Late invocation or uncertain timestamps

Begin logging now and summarize established state. Reconstruct earlier activity
only when requested and supported by timestamped evidence; use the current
observation time for newly received information, explaining any earlier event
time or uncertainty in its description.

Event times need event-specific evidence; message and commit times describe their
own events.
Preserve the declared time basis across resumptions and timezone changes; establish
one explicitly if the existing log has none.

## Logging unavailable

If the clock, file, or write permission is unavailable, report the gap and its
effect on tracking. Suspend the unavailable logging operation; continue the task
only within its existing permissions. Use another destination only by agreement.

When logging resumes, record the recovery and any unobserved interval honestly.
Confirm a successful write before closing the logging gap.

## Sensitive or bulky output

Use redacted summaries and safe artifact references, including credential-free
link targets. Keep large command output and detailed findings in the task's
appropriate artifacts.

## Requested archival

When archival is requested, preserve the older entries in an agreed artifact
under ignored `.ai`, confirm it is readable, and link it before shortening the
active record. Leave a brief entry describing the archive and where to find it.
