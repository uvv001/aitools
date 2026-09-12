# Research mode — mining past sessions for rules

The target here is session history rather than the live session. The
propose-then-persist gate still holds: research feeds step 2, it does not
bypass it.

## Locate the transcripts

Find where the host keeps session transcripts before planning the scan. Expect
one directory or file per session holding newline-delimited event records, with
the user's prompt text inside each user-message event, alongside whatever
summaries and artifacts the host preserves. A summary index, where one exists,
gives the storyline for a fraction of the tokens — read it first.

Individual event lines run to megabytes, because tool output and injected
context ride inside them. Grep with narrow patterns and head_limit; one full
transcript read can swallow the context window.

Any search index the host exposes is a lead generator rather than coverage:
treat its hits as pointers back into the transcripts.

## Scan

Sessions are numerous and large, so the first pass is mechanical rather than
agentic. Script a regex over user-message text carrying the vocabulary of the
ask — extract, distill, preserve, lessons, rules, guides, skill, subagent,
instruction-file names, "for review" — and record every hit with its session id,
timestamp, and full verbatim prompt into a working file.

Wrapper injections, system reminders, and code-level "extract this method" asks
dominate the raw hits; the verbatim prompt text makes sorting them cheap.

## Fleet

Delegate the reading to background subagents holding disjoint session scopes and
a strict report contract: verbatim prompts with timestamps, the proposal that
followed, the user's review decision, the document produced and its format, and a
link back for every claim (session id, event position, artifact path). Each agent
writes its own part file into the working folder and returns a compact summary.

Read-only agents cannot write part files, so persist their findings yourself when
you dispatch one.

Keep the scan, the aggregation, and the merge for the coordinating agent.

## Aggregate

Merge the part files into one results document under the project's ignored
working-notes directory, named `yyyy-mm-dd-<topic>-research.md` so parallel
investigations never collide. It carries the verbatim prompt catalog grouped by
pattern, the document formats observed, the review-and-persist workflows, and a
source link for every finding. Working artifacts stay out of version control;
the rules or skill the research feeds are what gets committed.
