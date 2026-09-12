# Choosing a progress filename

## Infer a useful name

Default to `yyyy-mm-dd[-ticket-or-pr]-short-work-description.md` under `.ai`.
Use the creation date, a few hyphen-separated topic words, and a Jira ID or PR
number only when it clearly belongs to the current work.

Use the current request and its explicit references first, then relevant branch
or task metadata. Ignore identifiers from unrelated earlier work. Examples:

- `2026-09-11-progress-tracking-skill.md`
- `2026-09-11-PROJ-123-login-investigation.md`
- `2026-09-11-pr-42-review.md`

When one name is clearly supported, choose it automatically and notify the user
of the final path. An explicit user filename takes precedence over inference.

## Ask only when the name is unclear

When the topic is absent or several meanings are equally plausible, use the
host's structured question tool. Offer two or three concrete filename suggestions
and an **Other** option accepting the user's final name as free text.

Keep tracking available during this choice: create a uniquely named provisional
`yyyy-mm-dd-session-<unique-token>.md` record using the normal summary and activity
log layout, and identify it as provisional before asking.
After selection, rename only that owned record, preserving its contents and
checking the destination again. Notify the user of the resulting path.

If interaction is unavailable or the naming question is declined, retain the
provisional record and explain the choice. An explicit request to stop tracking
overrides automatic initialization.

## Claim a distinct path

Treat an existing record owned by another or an unknown session as a collision,
including when the topic, date, branch, or ticket matches. Append a session token
or another distinguishing suffix and retry; never take over the existing file.

Use create-if-absent semantics when available so concurrent creators cannot both
claim the same name. If the available writer cannot create exclusively, include
a fresh unique token in the basename before creation rather than relying on a
shared check-then-write name.

Validate a user-supplied name as a filename inside `.ai`: reject directory
traversal, path separators, reserved names, and invalid characters. Keep it short
and use `.md`. Explain any necessary correction instead of silently substituting
a different user-selected name.

## Keep the binding stable

Once selected, keep the path through ordinary updates, midnight, and resumption.
Carry it in handoffs. A confirmed record can be resumed; an inherited path from
another session or fork is not sufficient proof of ownership.

A material scope change may justify a new record or a user-approved rename.
Keep the old record intact unless a move or cleanup is explicitly requested.
