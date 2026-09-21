# Review — skills/progress-tracking (round 1)

Reviewed state, pinned:

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/progress-tracking` → *(empty output: no staged, unstaged, or untracked changes under the skill directory)*

Scope: `SKILL.md`, `activation.md`, `edge-cases.md`, `naming.md`, `session-start.ps1`,
read in full. Instruction correctness and completeness only; prose style and code
formatting are out of scope. This report lives in git-ignored `.ai/` and is not
committed. Read-only round: no skill file was modified.

Checked and clean, recorded so later rounds do not re-litigate them:

- Repository self-sufficiency rule (root `AGENTS.md`): every link in the skill targets a
  file inside `skills/progress-tracking/` (`activation.md`, `edge-cases.md`, `naming.md`,
  `session-start.ps1`, anchor `edge-cases.md#git-storage`). No sibling-skill pointer. No finding.
- All referenced files exist; the `#git-storage` anchor matches `## Git storage` (edge-cases.md:29).
- `copilot skill add <directory>` ("Register a directory of skills"), `copilot skill list`,
  `copilot skill disable` all exist in the installed CLI — activation.md:16, :52, :58 are accurate.
- Hook payload/plumbing claims verified against the Copilot hooks reference: command hooks
  receive the JSON payload on stdin, `sessionStart` camelCase input is
  `{sessionId, timestamp, cwd, source: "startup"|"resume"|"new", initialPrompt?}`, `sessionStart`
  output may carry `additionalContext`, `exec`+`args` is CLI-supported, user hooks load from
  `%USERPROFILE%\.copilot\hooks\*.json` / `$COPILOT_HOME/hooks/`, and prompt hooks really do
  skip resume and `-p`. So activation.md:11-12, :22-36, :38-39 and the script's field names,
  `source` enum, and single-line `ConvertTo-Json -Compress` output all match the platform.
- `session-start.ps1` parses cleanly (`[System.Management.Automation.PSParser]::Tokenize`
  equivalent read-only inspection; the script itself was never executed).

## Dashboard

**Fix progress** — 0 🔧 fixed of 0 approved and awaiting a fix (nothing approved yet).

**Triage state** — 18 findings total: ⏳ 17 awaiting triage, ❓ 1 unverified,
✅ 0, 🔧 0, ❌ 0, 📌 0, 🔀 0.

Severity spread: 🔴 4, 🟡 10, ⚪ 4.

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: SKILL.md:32, :40-41; edge-cases.md:7-8; naming.md:37, :55-56<br>State: ⏳ Awaiting triage<br>Record "ownership" gates every reuse decision but no file defines how ownership is established or stored, so the resume branch has no executable test. |
| F2 | Severity: 🔴 High<br>File: SKILL.md:25-30; edge-cases.md:31-36<br>State: ⏳ Awaiting triage<br>Step 1 may place `.ai` at a non-repository root, but the Git procedure only ever writes and verifies the root-anchored rule `/.ai/`, so the verification fails with no defined branch. |
| F3 | Severity: 🔴 High<br>File: naming.md:47-50<br>State: ⏳ Awaiting triage<br>A user-supplied name that fails validation must be rejected and must not be silently replaced, but no instruction says what name to use instead — the naming path dead-ends. |
| F4 | Severity: 🔴 High<br>File: SKILL.md:16-17; activation.md:50-55; session-start.ps1:5-11<br>State: ⏳ Awaiting triage<br>SKILL.md routes "diagnosing a missing startup invocation" to activation.md, which contains installation and verification only — no failure branch, and the script's silent fail-open throw is undocumented. |
| F5 | Severity: 🟡 Medium<br>File: SKILL.md:64, :96; edge-cases.md:57-59<br>State: ⏳ Awaiting triage<br>"Read the clock" names no mechanism, so an agent cannot tell a real time source from a guessed one, and "unavailable" cannot be detected. |
| F6 | Severity: 🟡 Medium<br>File: SKILL.md:45, :95; naming.md:26-27<br>State: ⏳ Awaiting triage<br>Two later instructions require conformance to "the layout above" / "the normal summary and activity log layout", but the summary section is never given a heading or position. |
| F7 | Severity: 🟡 Medium<br>File: SKILL.md:49-52 vs :58-60<br>State: ⏳ Awaiting triage<br>The activity-log `[model]` field has an explicit `unknown` fallback; the contributor line format has none, leaving unknown model/harness/role undefined. |
| F8 | Severity: 🟡 Medium<br>File: SKILL.md:88-90, :92-94<br>State: ⏳ Awaiting triage<br>Step 3's exit criterion fires "at each work boundary" and counts "since the previous checkpoint", but neither term is defined and step 4 defines only checkpoint triggers. |
| F9 | Severity: 🟡 Medium<br>File: SKILL.md:27-28; edge-cases.md:72-74; naming.md:37-40<br>State: ⏳ Awaiting triage<br>Requiring every auxiliary `.ai` artifact to end in `_progress.md` makes archives and side artifacts indistinguishable from records, which the collision rule then treats as foreign records. |
| F10 | Severity: 🟡 Medium<br>File: SKILL.md:40-41 vs edge-cases.md:41<br>State: ⏳ Awaiting triage<br>Step 1's exit criterion demands an "ignored, untracked destination" unconditionally, while edge-cases explicitly forbids claiming an exclusion check outside Git. |
| F11 | Severity: 🟡 Medium<br>File: naming.md:25-26, :38, :44; activation.md:7-9; session-start.ps1:13-16<br>State: ⏳ Awaiting triage<br>Three different names for the disambiguating token and no stated source, while the hook already supplies a `sessionId` that no instruction consumes. |
| F12 | Severity: 🟡 Medium<br>File: activation.md:29, :39-40<br>State: ⏳ Awaiting triage<br>The hook config hard-codes `exec: "pwsh"` (PowerShell 7+) while the prose states only "requires PowerShell", so a Windows PowerShell 5.1 host silently fails the hook. |
| F13 | Severity: 🟡 Medium<br>File: session-start.ps1:1, :5-10<br>State: ⏳ Awaiting triage<br>`Set-StrictMode -Version Latest` makes a missing `sessionId`/`source` throw `PropertyNotFoundException` before the guard runs, so the intended error messages are unreachable. |
| F14 | Severity: ⚪ Low<br>File: SKILL.md:49-62<br>State: ⏳ Awaiting triage<br>The contributor example adds a markdown bullet the stated format does not contain, and the activity-log table has no worked example at all. |
| F15 | Severity: ⚪ Low<br>File: activation.md:18-20, :62-63<br>State: ⏳ Awaiting triage<br>Hook file name is unspecified, creating the hooks directory when absent is unstated, and the removal command is described instead of named. |
| F16 | Severity: ⚪ Low<br>File: session-start.ps1:18-20<br>State: ⏳ Awaiting triage<br>The injected instruction says "Apply its startup or resumption rules", terminology that appears nowhere in SKILL.md. |
| F17 | Severity: ⚪ Low<br>File: session-start.ps1:4<br>State: ⏳ Awaiting triage<br>`$event` shadows the PowerShell automatic variable `$Event`; rename to `$payload` to keep the script unambiguous. |
| F18 | Severity: 🟡 Medium<br>File: activation.md:11-12<br>State: ❓ Unverified<br>Could not confirm that `sessionStart` `additionalContext` is actually injected in `-p` and resumed sessions, as the claim "cover new and resumed sessions, including non-interactive operation" requires. |

## Findings

### ⏳ 🔴 F1 — Record ownership is required everywhere and defined nowhere

<details>
<summary>Description</summary>

Reuse of an existing record is gated on "confirmed" ownership, and the negative rules are
explicit, but no file states how ownership is established, recorded, or checked.

SKILL.md:32
```
Reuse a record only when it is confirmed to belong to this session and workstream.
```
SKILL.md:40-41
```
**Ready when:** An ignored, untracked destination is selected without taking over
another record; ownership and any provisional naming state are clear.
```
edge-cases.md:7-8
```
Re-invocation is idempotent for a confirmed session/workstream
binding; similarity of filenames or task descriptions is not ownership.
```
naming.md:55-56
```
Carry it in handoffs. A confirmed record can be resumed; an inherited path from
another session or fork is not sufficient proof of ownership.
```

Every one of these rules is a prohibition. The only positive identifier in the system is the
runtime session ID the hook injects — activation.md:7-9 ("with the runtime session ID and
startup/resume source") and session-start.ps1:13-16 — and no instruction tells the agent to
write it into the record or compare it on the next session. Consequence: on a resumed
session, or whenever a matching-looking `_progress.md` already exists, the agent has no
defined way to reach "confirmed" and therefore no defined outcome for the reuse-vs-create
branch. naming.md:37-40 then forces the collision path ("an existing record owned by another
or an unknown session"), so the literal reading always produces a new file, contradicting
edge-cases.md:7-8 idempotence and edge-cases.md:11 ("Startup integration reactivates tracking
on resumption").

Suggested fix: define the ownership token concretely — e.g. record `session: <sessionId>`
(plus harness) in the record header at creation, and state that reuse requires an exact match
of that value or explicit user direction.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High · Files: SKILL.md:32, :40-41; edge-cases.md:7-8, :11; naming.md:37-40, :55-56

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Cross-checked all four files plus session-start.ps1 for any
  definition of ownership or of a persisted session identifier; none exists.

</details>

### ⏳ 🔴 F2 — Git exclusion assumes a repository-root `.ai`, which step 1 does not guarantee

<details>
<summary>Description</summary>

Step 1 lets the storage root be something other than the repository root:

SKILL.md:25-28
```
Use the user's chosen workspace ahead of the shell's startup directory.
Otherwise use the active project root, or the current directory outside a project.
Store progress and auxiliary working artifacts under `.ai` at that root, each
named to end in `_progress.md`.
```

The exclusion procedure it delegates to only handles the root-level case:

edge-cases.md:31-36
```
Check both exclusion and index state: ignoring a path does not untrack it.
Reuse an existing rule covering root `.ai`. If one is absent, prefer the local
Git exclude file for automatic setup so unrelated tracked configuration stays
unchanged; locate it with `git rev-parse --git-path info/exclude` for worktree support.
Add `/.ai/` without replacing existing rules, then verify with `git check-ignore`.
```

`/.ai/` is anchored at the repository root. When the selected root is a subdirectory of the
repository (a user-chosen workspace, or a cwd inside a monorepo package), writing `/.ai/` does
not ignore `<subdir>/.ai/`, so the mandated `git check-ignore` verification fails and no branch
covers that outcome — while SKILL.md:29-30 still requires "confirm the record is ignored and
untracked". The instruction as written is incorrect for every non-root destination.

Suggested fix: either pin the storage root to the repository root inside a Git work tree, or
state the rule to write relative to the selected root (e.g. add the path of the chosen `.ai`
directory relative to the repo root) and keep `git check-ignore <record path>` as the check.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High · Files: SKILL.md:25-30; edge-cases.md:31-36

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Confirmed `/.ai/` semantics against this repository's own
  `.gitignore` (`/.ai/`, which matches `.ai/reviews/...` at the root only).

</details>

### ⏳ 🔴 F3 — A rejected user-supplied filename has no defined outcome

<details>
<summary>Description</summary>

naming.md:47-50
```
Validate a user-supplied name as a filename inside `.ai`: reject directory
traversal, path separators, reserved names, and invalid characters. Keep it short
and correct it to end in `_progress.md`. Explain any necessary correction instead
of silently substituting a different user-selected name.
```

Two outcomes are defined for a *correctable* name (shorten it, append the suffix, explain).
Nothing is defined for a *rejected* one: the agent may not use the requested name, and the
same sentence forbids substituting a different name. The request "track this in
`../notes/work.md`" therefore leaves the agent with no next action, while SKILL.md:8-9 still
requires initializing tracking before task work and naming.md:17 states "An explicit user
filename takes precedence over inference". The branch dead-ends.

Suggested fix: name the fallback explicitly — e.g. "on rejection, state why, propose a
conforming name derived from the request, and proceed with it unless the user objects;
if interaction is unavailable, use the provisional record from §Ask only when the name is
unclear."

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High · File: naming.md:47-50 (with SKILL.md:8-9, naming.md:17)

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🔴 F4 — Diagnosis is promised by SKILL.md but activation.md contains none

<details>
<summary>Description</summary>

SKILL.md:16-17
```
**Setup:** When installing automatic startup or diagnosing a missing startup
invocation, read [activation.md](activation.md).
```

activation.md offers installation plus a success checklist, and stops there:

activation.md:50-55
```
## Verification and removal

Confirm `copilot skill list` includes `progress-tracking`. Check a fresh session
without explicitly requesting the skill: its first task should initialize an
ignored `.ai` record and announce the chosen path. A resumed session should
reattach only its own confirmed record.
```

Nothing states what to do when that check fails: no mention of inspecting the hook file, of
`/env` (which lists loaded hooks), of piping a sample payload into the script to reproduce its
output, of `disableAllHooks` or repository settings that suppress hooks beyond the one-line
activation.md:43-44 note, or of where hook errors surface. The gap matters because the adapter
fails silently by design: the script raises terminating errors —

session-start.ps1:5-11
```
if ($null -eq $event -or $event.sessionId -isnot [string] -or
    [string]::IsNullOrWhiteSpace($event.sessionId)) {
    throw 'sessionStart requires a non-empty sessionId.'
}
if ($event.source -notin @('startup', 'resume', 'new')) {
    throw 'sessionStart requires source startup, resume, or new.'
}
```

— and per the Copilot hooks reference a non-zero exit from a non-`preToolUse` hook is "Logged
as a hook failure. The run continues (fail-open)". The user sees a normal session with no
tracking and no error, which is exactly the "missing startup invocation" case SKILL.md sends
the agent here to diagnose.

Suggested fix: add a short troubleshooting sequence to activation.md — confirm the hook file
parses and is in the active hooks directory, confirm `pwsh` resolves, reproduce with a piped
sample `sessionStart` payload and inspect stdout/exit code, check `/env` and hook-disable
settings — and state the fail-open behavior so the absence of an error is not read as success.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High · Files: SKILL.md:16-17; activation.md:42-44, :50-55; session-start.ps1:5-11

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Fail-open behavior verified in the Copilot hooks reference
  ("Exit codes for command hooks": other non-zero → "Logged as a hook failure. The run continues").

</details>

### ⏳ 🟡 F5 — "Read the clock" names no mechanism

<details>
<summary>Description</summary>

SKILL.md:64-66
```
Read the clock for new entries. New logs use full ISO 8601 timestamps with a UTC
offset; existing logs retain their declared time convention. Record the actual
logging start, resumption, or task transition.
```

No source is named (harness-provided current datetime, shell `Get-Date`/`date`, or file
metadata), and no instruction forbids writing a remembered or inferred time. The downstream
check depends on that missing definition — SKILL.md:96 requires "new timestamps have a known
basis" — and edge-cases.md:57-59 treats an unavailable clock as a suspend-logging condition
("If the clock, file, or write permission is unavailable, report the gap"), which an agent
cannot detect without knowing what reading the clock means.

Suggested fix: name the allowed sources in priority order and state that a timestamp with no
such source is not written.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · Files: SKILL.md:64-66, :96; edge-cases.md:57-59

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F6 — The record layout is referenced as a standard but never fully specified

<details>
<summary>Description</summary>

Two sections are named exactly — `## Contributors` (SKILL.md:49) and `## Activity log`
(SKILL.md:57) — but the summary is described only by content:

SKILL.md:45
```
Keep a short summary of the goal, current state, and next action.
```

Later instructions treat the layout as a fixed, checkable artifact:

SKILL.md:95
```
pending decisions, and next action. Check that the record follows the layout above,
```
naming.md:26-27
```
`yyyy-mm-dd-session-<unique-token>_progress.md` record using the normal summary
and activity log layout, and identify it as provisional before asking.
```

With no heading, position, or title convention for the summary (and no statement that the
document starts with an H1), two agents produce different files and the step-4 check has
nothing to compare against.

Suggested fix: pin the skeleton once — title, `## Summary` (fields), `## Contributors`,
`## Activity log` — and let the other files point at it.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · Files: SKILL.md:45, :95; naming.md:26-27

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F7 — Contributor lines have no fallback for unknown identity

<details>
<summary>Description</summary>

SKILL.md:49-52
```
A `## Contributors` section immediately before the log lists one line per
contributor, `<model> (<harness>, <role>): <contribution phrase>` — orchestrator
first, each subagent added on its first report. Update a line only when that
contributor's work materially expands.
```

The log line, ten lines later, does define the missing-value case:

SKILL.md:58-60
```
`Date/time` and `Description`. Each description is a short, single-line note
opening with `[model]`, the harness-reported identity of the model responsible
for the logged work (`unknown` when unavailable); a subagent's reported work
```

So an agent that cannot obtain its own model name (or a subagent's, which the parent often
cannot observe when the runtime resolves defaults) knows what to write in the log and not in
the contributor list. The step-2 exit criterion depends on the contributor list existing —
SKILL.md:72 "the contributor list is open with the orchestrator" — so the gap blocks a checkable
condition.

Suggested fix: apply the same `unknown` fallback to each field of the contributor line, and say
which field carries it.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · File: SKILL.md:49-52, :58-60, :72

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F8 — "Work boundary" is an undefined trigger, and drifts against "checkpoint"

<details>
<summary>Description</summary>

SKILL.md:88-90
```
**At each work boundary:** Every substantial attempt since the previous checkpoint
has an outcome or an explicit waiting/blocking note, every contributor that
produced work is listed, and the summary reflects it.
```

"Work boundary" appears once in the skill and is never defined; the same sentence measures
from "the previous checkpoint", a different noun whose triggers are defined only in the next
section:

SKILL.md:94
```
Before pausing, handing off, or responding with a result, save the current state,
```

An agent cannot tell whether step 3's criterion must hold continuously, at every tool
boundary, or only at the step-4 moments. Either make them the same term or define the boundary
separately.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · File: SKILL.md:88-90, :92-94

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F9 — The `_progress.md` suffix is imposed on artifacts that are not records

<details>
<summary>Description</summary>

SKILL.md:27-28
```
Store progress and auxiliary working artifacts under `.ai` at that root, each
named to end in `_progress.md`.
```

"each" covers auxiliary artifacts, yet everything else in the skill treats a `_progress.md`
name as a record identity. The archival path creates exactly such an auxiliary artifact:

edge-cases.md:72-74
```
When archival is requested, preserve the older entries in an agreed artifact
under ignored `.ai`, confirm it is readable, and link it before shortening the
active record. Leave a brief entry describing the archive and where to find it.
```

and the collision rule then reads any unrecognized `_progress.md` as a foreign record:

naming.md:37-40
```
Treat an existing record owned by another or an unknown session as a collision,
including when the topic, date, branch, or ticket matches. Insert a session token
or another distinguishing element before `_progress` and retry; never take over
the existing file.
```

A later session (or the same one after F1's ownership gap) sees archives and side artifacts as
other sessions' records. naming.md is titled "Choosing a progress filename" and gives no naming
scheme for non-record artifacts, so the suffix rule is also unimplementable as stated.

Suggested fix: scope the suffix to progress records and state a distinct convention (or an
explicit "no convention") for auxiliary artifacts, including archives.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · Files: SKILL.md:27-28; edge-cases.md:72-74; naming.md:1, :37-40

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F10 — Step 1's exit criterion cannot be satisfied outside a Git repository

<details>
<summary>Description</summary>

SKILL.md:40-41
```
**Ready when:** An ignored, untracked destination is selected without taking over
another record; ownership and any provisional naming state are clear.
```

The body of step 1 scopes the check correctly ("In Git repositories, confirm the record is
ignored and untracked", SKILL.md:29), and edge-cases is explicit about the non-Git case:

edge-cases.md:41
```
Outside Git, use `.ai` without pretending an exclusion check was performed.
```

As written, the exit criterion demands a property that does not exist outside Git; an agent
following it literally either stalls or claims an exclusion check it did not perform — the
precise behavior edge-cases forbids.

Suggested fix: qualify the criterion ("in a Git work tree, ignored and untracked; otherwise a
writable `.ai` destination").

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · Files: SKILL.md:29, :40-41; edge-cases.md:41

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F11 — The disambiguating token has three names and no source

<details>
<summary>Description</summary>

naming.md:25-26
```
Keep tracking available during this choice: create a uniquely named provisional
`yyyy-mm-dd-session-<unique-token>_progress.md` record using the normal summary
```
naming.md:38
```
including when the topic, date, branch, or ticket matches. Insert a session token
```
naming.md:44
```
a fresh unique token in the basename before creation rather than relying on a
```

Three labels — `<unique-token>`, "session token", "fresh unique token" — with no statement of
what produces them, whether they must be stable across a session, or whether the three are the
same thing. Meanwhile the hook already delivers a stable identifier that no instruction
consumes:

activation.md:7-9
```
The hook returns `additionalContext` directing the agent to invoke the skill
before handling the first request, with the runtime session ID and startup/resume
source.
```
session-start.ps1:13-16
```
$metadata = [ordered]@{
    sessionId = $event.sessionId
    source = $event.source
} | ConvertTo-Json -Compress
```

Suggested fix: define one token (short prefix of the runtime session ID, with a random fallback
when absent), use one name for it, and say whether the collision token must differ from the
provisional one. Pairs with F1.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · Files: naming.md:25-26, :38, :44; activation.md:7-9; session-start.ps1:13-16

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ 🟡 F12 — The stated PowerShell prerequisite is weaker than the hook configuration requires

<details>
<summary>Description</summary>

activation.md:29-30
```
        "exec": "pwsh",
        "args": ["-NoLogo", "-NoProfile", "-File", "<absolute-script-path>"],
```
activation.md:38-40
```
The default user hook directory is `%USERPROFILE%\.copilot\hooks` on Windows.
When `COPILOT_HOME` is set, use its `hooks` directory instead. This adapter requires
PowerShell on the host running the CLI.
```

`pwsh` is PowerShell 7+ and is not present on a stock Windows install, which ships
`powershell.exe` (5.1) only; GitHub's own hooks how-to states the Windows prerequisite as
"PowerShell 7.0 or later installed and in your PATH". With `exec` there is no shell resolution
and no fallback entry, so on a 5.1-only host the hook fails to spawn — and per F4 that failure
is logged, not surfaced. "requires PowerShell" understates the precondition and gives the
installer nothing to check.

Suggested fix: state "PowerShell 7+ (`pwsh`) on PATH", add the `pwsh --version` check, and note
the alternative of pointing `exec` at `powershell.exe` only if the script is verified on 5.1.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · File: activation.md:29-30, :38-40

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Prerequisite cross-checked against the Copilot CLI hooks
  how-to ("require you to have PowerShell 7.0 or later installed and in your PATH").

</details>

### ⏳ 🟡 F13 — Strict mode makes the script's own validation messages unreachable

<details>
<summary>Description</summary>

session-start.ps1:1-11
```
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$event = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
if ($null -eq $event -or $event.sessionId -isnot [string] -or
    [string]::IsNullOrWhiteSpace($event.sessionId)) {
    throw 'sessionStart requires a non-empty sessionId.'
}
if ($event.source -notin @('startup', 'resume', 'new')) {
    throw 'sessionStart requires source startup, resume, or new.'
}
```

Under `Set-StrictMode -Version Latest`, referencing an absent property of the `PSCustomObject`
returned by `ConvertFrom-Json` throws before the comparison is evaluated. Verified on
PowerShell 7.6.5, without running the script:

```
'{"source":"startup"}' | ConvertFrom-Json  →  $obj.sessionId
EXCEPTION: PropertyNotFoundException :: The property 'sessionId' cannot be found on this object.
```

So a payload missing `sessionId` (or missing `source`) exits with a PowerShell strict-mode
error instead of the intended diagnostic, which is the opposite of what these guards exist for —
and the misleading message is the only artifact a diagnostician gets (F4). The `$null -eq $event`
arm is sound: `'' | ConvertFrom-Json` returns `$null` on 7.6.5 (verified), and `-or`
short-circuits.

Suggested fix: test presence first, e.g.
`if (-not $event -or -not $event.PSObject.Properties['sessionId'] -or …)`, and likewise for
`source`.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium · File: session-start.ps1:1, :5-10

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Behavior verified with equivalent one-liners in a separate
  `pwsh -NoProfile` process; `session-start.ps1` itself was not executed.

</details>

### ⏳ ⚪ F14 — Examples do not match the formats they illustrate

<details>
<summary>Description</summary>

The contributor format is specified as a bare line, while the example is a markdown list:

SKILL.md:49-50
```
A `## Contributors` section immediately before the log lists one line per
contributor, `<model> (<harness>, <role>): <contribution phrase>` — orchestrator
```
SKILL.md:54-55
```
- kimi-k3 (copilot, orchestrator): record keeping, skill edits
- gpt-5.6-luna (copilot, explore agent): auth flow trace
```

Nothing says whether the `- ` marker belongs to the format, and the example is not labelled as
one. The activity log gets the opposite treatment — a strict rule with no example at all
(SKILL.md:57-62), so the header row, separator, and timestamp rendering are left to guesswork,
which weakens the "exactly two columns" requirement it states.

Suggested fix: label the contributor sample as an example matching the stated format, and add a
two-row activity-log sample.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low · File: SKILL.md:49-62

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ ⚪ F15 — Installation step 2 leaves file name, directory creation, and removal command implicit

<details>
<summary>Description</summary>

activation.md:18-20
```
2. In the user hook directory, add a dedicated JSON file with this structure.
   Set the script argument to the absolute path of this skill's `session-start.ps1`.
   Preserve other hook files and existing settings.
```

No file name is suggested (the platform requires a `*.json` file in that directory) and the
common case of the hooks directory not existing yet is unstated. The removal instruction
similarly describes a command rather than naming it:

activation.md:62-63
```
Keep the library registration for other definitions, or remove it with the CLI's
skill-directory removal command when the whole directory is no longer wanted.
```

`copilot skill remove <directory>` exists and is named in the CLI's own help; the neighbouring
sentences already name `copilot skill list` and `copilot skill disable`.

Suggested fix: propose a concrete name (e.g. `progress-tracking-hooks.json`), say to create the
directory when absent, and name `copilot skill remove`.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low · File: activation.md:18-20, :62-63

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. `copilot skill remove` confirmed present in `copilot skill --help`.

</details>

### ⏳ ⚪ F16 — The injected instruction names rules that SKILL.md does not have

<details>
<summary>Description</summary>

session-start.ps1:18-20
```
$context = 'Progress tracking: invoke the progress-tracking skill before handling ' +
    'the first request in this primary session, even for brief work. Apply its ' +
    'startup or resumption rules. Session metadata: ' + $metadata
```

SKILL.md has no "startup rules" or "resumption rules" — its sections are numbered steps 1-4,
and resumption guidance is spread across SKILL.md:99 and edge-cases.md:10-12. The phrase sends
the agent looking for a section that does not exist. The same applies to "primary session",
which is used in the front matter (SKILL.md:3) and here but defined nowhere; the closest
statement is SKILL.md:34 ("Coordinated subagents report to their parent rather than create
competing records").

Suggested fix: point at what exists ("follow SKILL.md step 1, then the resumption guidance in
edge-cases.md") and define "primary session" once in SKILL.md.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low · Files: session-start.ps1:18-20; SKILL.md:3, :34

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1.

</details>

### ⏳ ⚪ F17 — `$event` shadows a PowerShell automatic variable

<details>
<summary>Description</summary>

session-start.ps1:4
```
$event = [Console]::In.ReadToEnd() | ConvertFrom-Json -ErrorAction Stop
```

`$Event` is a PowerShell automatic variable (populated inside event-subscriber action blocks).
Assignment at script scope works — verified on 7.6.5 — so this is not a defect, but the name
invites confusion in a script whose whole subject is an "event" payload.

Suggested fix: rename to `$payload`.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low · File: session-start.ps1:4

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1. Confirmed the assignment itself does not error.

</details>

### ❓ 🟡 F18 — Unverified: `additionalContext` delivery on resume and in `-p`

<details>
<summary>Description</summary>

activation.md:11-12
```
Command hooks cover new and resumed sessions, including non-interactive operation.
A prompt-type startup hook is not used because it skips resume and `-p` sessions.
```

The second sentence is confirmed by the platform documentation (prompt hooks "fire only for
new interactive sessions. They do not fire on resume, and they do not fire in non-interactive
prompt mode (`-p`)"), and `sessionStart` is documented to fire when "A new or resumed session
begins" with output "Optional — can inject `additionalContext` into the session". What I could
not confirm is the claim this skill depends on: that the injected `additionalContext` actually
reaches the model in a `-p` run and in a `--resume`/`--continue` run, rather than only being
accepted from the hook.

Tried: the Copilot hooks reference (events table, `sessionStart` payload section, exit-code
table) and the "Using hooks with Copilot CLI" how-to; neither states the injection behavior per
session mode. No installed hook exists locally to observe, and installing one would modify the
user's environment, which is out of scope for a read-only review.

Settles it: install the hook in a scratch `COPILOT_HOME`, then run `copilot -p "say hi"` and a
`copilot --resume` session and check whether the injected text is present (session log, `/env`,
or by asking the agent to echo the instruction it received). If `-p` or resume does not
receive it, activation.md:11 needs correcting and the skill needs a fallback path.

</details>

<details>
<summary>Status</summary>

State: ❓ Unverified · Severity: 🟡 Medium · File: activation.md:11-12

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 as unverified; evidence attempted as described above.

</details>

## Resolved and discarded

*(none yet — findings move here when fixed 🔧 or discarded ❌, with their evidence and disposition)*
