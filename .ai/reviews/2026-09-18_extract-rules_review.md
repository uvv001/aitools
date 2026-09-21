# extract-rules — instruction review (round 1)

Target: `skills/extract-rules/` (`SKILL.md`, `research-mode.md`).
Scope: correctness and completeness of the instructions — followability, branch
coverage, internal consistency, referenced files and commands. Prose style and
formatting are out of scope.

**Reviewed state**

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/extract-rules` → *(empty output — no
  uncommitted changes in the skill directory; the review pins the committed state)*

The report lives in the git-ignored `.ai/reviews/` folder (`.gitignore:1` → `/.ai/`,
confirmed with `git check-ignore -v`) and is not committed.

## Dashboard

**Fix progress** — 0 findings marked 🔧, against 0 approved and awaiting a fix
(nothing triaged yet, so no finding is approved for fixing).

**Triage state** — 19 findings total: 18 ⏳ awaiting triage, 1 ❓ unverified,
0 ✅, 0 🔧, 0 ❌, 0 📌, 0 🔀.

Severity spread: 🔴 4, 🟡 11, ⚪ 4.

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: skills/extract-rules/SKILL.md:42-45<br>State: ⏳ Awaiting triage<br>The propose→persist approval gate is never instructed: step 2 has no halt-and-wait, "approved" is undefined, and partial/zero approval has no branch. |
| F2 | Severity: 🔴 High<br>File: skills/extract-rules/SKILL.md:33-35, 51-55<br>State: ⏳ Awaiting triage<br>Step 3 persists only into instruction files; the workflow-guide, skill/subagent, and saved-prompt destinations from step 2 have no persist procedure. |
| F3 | Severity: 🔴 High<br>File: skills/extract-rules/research-mode.md:24-28, 35-39, 48-53<br>State: ⏳ Awaiting triage<br>Research mode produces a catalog of past extraction *prompts*, not lessons with draft rule text and evidence, so its output cannot enter step 2 as written. |
| F4 | Severity: 🔴 High<br>File: skills/extract-rules/SKILL.md:47-49, 60-61<br>State: ⏳ Awaiting triage<br>A rule contradicted by validation is neither written nor awaiting wording, so step 3's "Ready when" is unsatisfiable and "ask the user" has no resumption branch. |
| F5 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:57-58, 69-70<br>State: ⏳ Awaiting triage<br>The wording stage holds the commit but no instruction returns to writing/committing after confirmation, while step 4 demands commit ids for everything. |
| F6 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:19-29<br>State: ⏳ Awaiting triage<br>Step 1's exit demands draft rule text and a destination, neither of which the step body instructs; the destination vocabulary and selection rule appear only later. |
| F7 | Severity: 🟡 Medium<br>File: skills/extract-rules/research-mode.md:27-28, 38-39, 48-49<br>State: ⏳ Awaiting triage<br>Working storage is named three different ways, never defined, never created, and its meaning lives only in sibling skills the self-sufficiency rule forbids leaning on. |
| F8 | Severity: 🟡 Medium<br>File: skills/extract-rules/research-mode.md:9-13<br>State: ⏳ Awaiting triage<br>"Locate the transcripts" gives no discovery method and no branch for a host that exposes none, dead-ending research mode at its first stage. |
| F9 | Severity: 🟡 Medium<br>File: skills/extract-rules/research-mode.md:35-42<br>State: ⏳ Awaiting triage<br>The fleet report contract assumes part files; for read-only agents nothing restates how the contract survives inside a "compact summary", and agent type is never chosen. |
| F10 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:35-37<br>State: ⏳ Awaiting triage<br>The value-rank example is a single cross-entry line, contradicting the rule that makes the rank a per-entry field. |
| F11 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:23-25, 47<br>State: ⏳ Awaiting triage<br>"Holds up when tested" is a step-1 keep criterion but validation only happens in step 3, and untestable lessons have no defined treatment. |
| F12 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:28-33<br>State: ⏳ Awaiting triage<br>No branch for a session where nothing clears the durability bar; step 2 has no empty-list form and no stop instruction. |
| F13 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:51-53<br>State: ⏳ Awaiting triage<br>Instruction-file discovery names no filenames or glob patterns, "nearest the lesson's scope" is undefined, and the create-one branch is circular. |
| F14 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:53-55<br>State: ⏳ Awaiting triage<br>No branch for an approved rule that duplicates or contradicts a rule already present in the destination file. |
| F15 | Severity: ⚪ Low<br>File: skills/extract-rules/SKILL.md:65-67<br>State: ⏳ Awaiting triage<br>`git diff --check` only covers whitespace/conflict markers in unstaged changes, and the step never instructs staging or creating the commit it reports. |
| F16 | Severity: ⚪ Low<br>File: skills/extract-rules/SKILL.md:63-70<br>State: ⏳ Awaiting triage<br>Step 4 assumes a git repository; a destination outside one has no completion path and no out-of-scope declaration. |
| F17 | Severity: ⚪ Low<br>File: skills/extract-rules/SKILL.md:14-15<br>State: ⏳ Awaiting triage<br>The live-session/past-session routing is exclusive ("rather than"), leaving an ask that spans both without a route. |
| F18 | Severity: ⚪ Low<br>File: skills/extract-rules/research-mode.md:7-53<br>State: ⏳ Awaiting triage<br>None of research mode's four stages carries a "Ready when", unlike every step in SKILL.md, so coverage and completion are unjudgeable. |
| F19 | Severity: 🟡 Medium<br>File: skills/extract-rules/SKILL.md:12<br>State: ❓ Unverified — awaiting triage<br>Unclear whether user-supplied rule text is auto-approved (bypassing propose, evidence, and destination selection) or still owes step 2. |

## Findings

### ⏳ 🔴 F1 — Propose→persist approval gate is never instructed

<details>
<summary>Description</summary>

The skill's central invariant is stated up front (`SKILL.md:9-10`):

> Lessons are
> **proposed**; only approved ones are **persisted**.

But step 2 never tells the agent to stop, hand the list over, and wait. Its exit
criterion (`SKILL.md:42-43`) is satisfied the moment the list is drafted:

> **Ready when:** every lesson carries its number, a draft, and evidence, and every
> destination file is still untouched.

Step 3 then opens as if approval had happened (`SKILL.md:45`):

> ## 3. Persist the approved

Three gaps follow. (a) Nothing halts the agent between the two steps, so a literal
reading lets it present the list and continue writing in the same turn — the
"destination file is still untouched" check passes at the moment it is made, then
stops being true. (b) "Approved" is never defined: no signal is named (a list of
numbers, "yes", silence, an edited draft). (c) No branch covers partial approval,
approval with amended wording, or approval of nothing.

Suggested fix: add an explicit "stop here; do not write until the user answers"
instruction to step 2, name what counts as approval, and define the branches for
subset approval, amended wording, and zero approvals.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🔴 F2 — Three of four destinations have no persist procedure

<details>
<summary>Description</summary>

Step 2 enumerates four destination kinds (`SKILL.md:33-35`):

> Present the lessons as a numbered list grouped by destination: project rules
> (the repo's agent instruction file), workflow guide, new skill or subagent,
> saved prompt.

and adds a contract for one of them (`SKILL.md:37-38`):

> A skill or subagent candidate adds
> Trigger, Purpose, and Boundary.

Step 3, however, describes only the instruction-file case (`SKILL.md:51-55`):

> Write each approved rule to the closest-scoped destination: glob the
> instruction-file hierarchy and pick the file nearest the lesson's scope; when the
> repo has none, create one where the agent already reads them. Rules land as
> imperative bullets inside an existing section with the reason embedded in the
> bullet; a new section earns its place only when no section fits.

An approved skill candidate, subagent, workflow guide, or saved prompt cannot be
persisted by following this: no location, no file name, no format, and "imperative
bullets inside an existing section" does not describe any of them. Step 4's exit
(`SKILL.md:69-70`, "destinations contain exactly the approved set") is therefore
uncheckable for those approvals.

Suggested fix: add a short per-destination persist rule (where the file goes, what
shape it takes), or state that non-instruction-file destinations are proposed only
and handed off elsewhere — an explicit out-of-scope declaration also closes this.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🔴 F3 — Research mode's output does not match what step 2 consumes

<details>
<summary>Description</summary>

Research mode declares its handoff (`research-mode.md:3-5`):

> The
> propose-then-persist gate still holds: research feeds step 2, it does not
> bypass it.

Its scan and report contract, though, target past *requests for rule extraction*
and the artifacts they produced (`research-mode.md:25-28`):

> Script a regex over user-message text carrying the vocabulary of the
> ask — extract, distill, preserve, lessons, rules, guides, skill, subagent,
> instruction-file names, "for review" — and record every hit with its session id,
> timestamp, and full verbatim prompt into a working file.

(`research-mode.md:36-38`):

> verbatim prompts with timestamps, the proposal that
> followed, the user's review decision, the document produced and its format, and a
> link back for every claim

(`research-mode.md:50-52`):

> It carries the verbatim prompt catalog grouped by
> pattern, the document formats observed, the review-and-persist workflows, and a
> source link for every finding.

Two mismatches. (a) The frontmatter promises lesson mining — `SKILL.md:3`: "or to
mine past sessions for rule candidates" — but the procedure mines past *extraction
episodes* (which prompts were used, what was proposed, what the user decided, what
document format resulted). That is meta-research about this workflow, frozen to one
specific investigation, not rule candidates from past work. (b) Even if the catalog
is treated as raw material, no step converts hits into what step 2 requires —
`SKILL.md:42-43`: "every lesson carries its number, a draft, and evidence" — and
because research "feeds step 2", step 1's durability bar (`SKILL.md:23-26`) is
skipped with nothing put in its place.

Suggested fix: derive the scan vocabulary from the user's actual ask (or label the
listed words as one worked example), and add the conversion stage: hits → lessons
held to the durability bar, each with draft rule text, evidence link, and
destination, before entering step 2.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🔴 F4 — Failed validation produces a state no exit criterion admits

<details>
<summary>Description</summary>

Step 3 opens with a validation branch (`SKILL.md:47-49`):

> Validate a testable rule before codifying it: compile or run the claim. When the
> result contradicts the rule, report the evidence and ask the user, leaving
> destinations as they stand.

Its exit offers exactly two states (`SKILL.md:60-61`):

> **Ready when:** every approved rule is written, or its wording awaits the user's
> confirmation.

A rule whose validation contradicted it is in neither state: not written, not
awaiting wording confirmation. The step cannot be declared done, and the branch
dead-ends — after "ask the user" nothing says what the answers lead to (rewrite the
rule to match the evidence, drop it, persist it anyway, re-validate). Step 4's exit
(`SKILL.md:69-70`, "destinations contain exactly the approved set") compounds it:
an approved rule withdrawn on evidence makes "exactly the approved set" false.

Suggested fix: add the third exit alternative (blocked on contradicting evidence,
with the user's decision recorded), name the branches that follow the question, and
let step 4's exit read against the *final* approved set rather than the original.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F5 — Wording stage has no return path into step 4

<details>
<summary>Description</summary>

Step 3 may suspend work (`SKILL.md:57-58`):

> Offer a wording stage when the user engages on phrasing or supplies a rule seed:
> write the exact text, hold the commit, wait for confirmation.

and is allowed to exit in that state (`SKILL.md:60-61`, "or its wording awaits the
user's confirmation"). Step 4 then demands the opposite (`SKILL.md:69-70`):

> **Ready when:** destinations contain exactly the approved set, and the user holds
> the commit ids.

No instruction says what happens when the confirmation arrives: whether to return
to step 3's write, whether the other approved rules commit meanwhile or wait for
the held one, and — if they commit separately — how that squares with
`SKILL.md:65-66`, "Rules ship as their own docs commit, separate from feature work"
(one commit for the batch, or one per rule?).

Suggested fix: state the resume-on-confirmation step and whether pending wording
blocks the whole commit or only its own rule.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F6 — Step 1's exit demands outputs step 1 never asks for

<details>
<summary>Description</summary>

The body of step 1 instructs mining friction, applying the durability bar, and
anchoring evidence (`SKILL.md:19-26`), ending with:

> Anchor each lesson you keep in evidence — what happened, and where
> (file, commit, turn).

The exit then asks for two more artifacts (`SKILL.md:28-29`):

> **Ready when:** every point of friction is judged keep-or-drop, and each kept
> lesson carries draft rule text, its evidence, and a destination.

Neither "draft rule text" nor "a destination" is produced by anything in the step.
Worse, the vocabulary needed to pick a destination arrives only in step 2
(`SKILL.md:33-35`, the four destination kinds) and the selection procedure only in
step 3 (`SKILL.md:51-53`, "glob the instruction-file hierarchy and pick the file
nearest the lesson's scope"). An agent working the steps in order cannot satisfy
step 1's exit without reading ahead, and destination choice ends up specified
twice, in two places, with different criteria.

Suggested fix: either move drafting and destination selection into step 1's body
(with a pointer to the destination list), or drop them from step 1's exit and let
step 2 own them.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F7 — Working storage: three names, no definition, no creation step

<details>
<summary>Description</summary>

Research mode writes to a location it never defines, under three different names
(`research-mode.md:27-28`):

> record every hit with its session id,
> timestamp, and full verbatim prompt into a working file.

(`research-mode.md:38-39`):

> Each agent
> writes its own part file into the working folder and returns a compact summary.

(`research-mode.md:48-49`):

> Merge the part files into one results document under the project's ignored
> working-notes directory

Nothing names the directory, instructs creating it, or verifies it is ignored —
yet `research-mode.md:52-53` depends on that property: "Working artifacts stay out
of version control". Whether the three phrases denote one place is left to
inference, and the fleet contract needs a concrete shared path because each
subagent must be told where to drop its part file.

The `.ai/` convention that would supply this meaning exists only in sibling skills
— `skills/progress-tracking/SKILL.md:12` ("Working notes belong in ignored `.ai`
storage") and `skills/review-with-docs/SKILL.md:80` ("ignored working folder
(`.ai/`)") — and the repository rule in `AGENTS.md:8-11` forbids this skill from
leaning on them: "Keep each skill self-sufficient: reference only files inside its
own directory."

Suggested fix: name the directory inside this skill, instruct creating it and
confirming it is git-ignored before the scan, and use one term throughout.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F8 — No failure path when transcripts cannot be located

<details>
<summary>Description</summary>

Research mode's first stage (`research-mode.md:9-13`):

> Find where the host keeps session transcripts before planning the scan. Expect
> one directory or file per session holding newline-delimited event records, with
> the user's prompt text inside each user-message event, alongside whatever
> summaries and artifacts the host preserves. A summary index, where one exists,
> gives the storyline for a fraction of the tokens — read it first.

It describes what to expect but not how to find it (candidate paths, environment
variables, a host-provided session store or query interface), and there is no
branch for the host that keeps no transcripts, denies access, or stores them in a
form the scan cannot read. Since `SKILL.md:14-15` routes the entire past-sessions
ask into this file, a failure here leaves the whole request without a defined
outcome — no fallback to the live session, no instruction to report the limit.

Suggested fix: list concrete discovery moves and add the explicit branch: when no
transcript store is reachable, say so, and name what happens next.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F9 — Fleet contract vs read-only agents leaves the agent type and the return shape undefined

<details>
<summary>Description</summary>

The fleet contract is written around part files (`research-mode.md:35-39`):

> Delegate the reading to background subagents holding disjoint session scopes and
> a strict report contract: verbatim prompts with timestamps, the proposal that
> followed, the user's review decision, the document produced and its format, and a
> link back for every claim (session id, event position, artifact path). Each agent
> writes its own part file into the working folder and returns a compact summary.

Then (`research-mode.md:41-42`):

> Read-only agents cannot write part files, so persist their findings yourself when
> you dispatch one.

Unresolved: nothing says which agent type to dispatch by default, so the choice —
and the whole persistence mechanism — is left open at dispatch time. And in the
read-only case the full contract (verbatim prompts, per-claim links) must travel
back inside what the previous sentence calls a "compact summary"; the tension is
never reconciled, nor is a size/truncation rule given, which matters because
`research-mode.md:15-17` warns that a single transcript read "can swallow the
context window".

Suggested fix: name the default agent type, and restate the return contract for the
read-only path (what the summary must carry verbatim, what may be elided).

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F10 — Value-rank example contradicts the rule it illustrates

<details>
<summary>Description</summary>

`SKILL.md:35-37`:

> Each entry carries its destination, draft rule text, evidence, and
> your value rank with one line of triage ("most non-obvious: 1, 4") — the rank is
> advisory, and the user overrides it freely.

The rule makes the rank a per-entry attribute ("Each entry carries … your value
rank"), while the example is a single cross-entry line naming entries 1 and 4 —
which belongs after the list, not inside an entry. The axis also shifts: the rule
says "value rank", the example ranks by "most non-obvious". An agent cannot tell
whether to score every entry, to add one summary line, or both.

Suggested fix: pick one form — per-entry rank or a single closing triage line —
and make the example an instance of it.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F11 — "Holds up when tested" is a step-1 criterion but validation lives in step 3

<details>
<summary>Description</summary>

Step 1's durability bar (`SKILL.md:23-25`):

> Hold each to the durability bar: a lesson outlives the component that taught it,
> stays non-obvious to whoever would otherwise learn it the hard way, and holds up
> when tested.

Step 3 owns the only testing instruction (`SKILL.md:47`):

> Validate a testable rule before codifying it: compile or run the claim.

So the keep/drop judgement at step 1 depends on a result that, by the process's own
ordering, is produced two steps later and only after approval. Nothing says whether
step 1 should run the check early, judge plausibility, or defer. Separately, "a
testable rule" concedes that some rules are not testable, but step 1's bar has no
carve-out for them: a lesson that cannot be executed (a convention, a preference, a
process rule) fails "holds up when tested" on a literal read.

Suggested fix: say explicitly that execution happens at step 3 and how the bar
reads for a claim that cannot be executed.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F12 — No branch when nothing clears the durability bar

<details>
<summary>Description</summary>

Step 1 can legitimately end with every candidate dropped — its exit only requires a
verdict (`SKILL.md:28-29`):

> **Ready when:** every point of friction is judged keep-or-drop, and each kept
> lesson carries draft rule text, its evidence, and a destination.

Step 2 has no form for that outcome (`SKILL.md:33`):

> Present the lessons as a numbered list grouped by destination

A numbered list grouped by destination, an opener promising review
(`SKILL.md:40`), and an exit requiring "every lesson carries its number, a draft,
and evidence" all presuppose at least one lesson. Nothing instructs the agent to
report that the session produced nothing durable and stop, so the empty case falls
through the process.

Suggested fix: add the zero-lesson exit — report the dropped candidates and the
reason, then stop without entering step 3.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F13 — Instruction-file discovery is underspecified and its fallback is circular

<details>
<summary>Description</summary>

`SKILL.md:51-53`:

> Write each approved rule to the closest-scoped destination: glob the
> instruction-file hierarchy and pick the file nearest the lesson's scope; when the
> repo has none, create one where the agent already reads them.

Three unresolved pieces. (a) "the instruction-file hierarchy" names no patterns —
`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursor/rules/*` all
qualify on different hosts, and the glob cannot be written without them; the
frontmatter names one (`SKILL.md:3`, "update AGENTS.md from recent work") but the
body never does. (b) "nearest the lesson's scope" is undefined — nearest in
directory distance to the files the lesson touched, or in topical scope? (c) The
create-one branch is circular: it fires precisely when the repo has no instruction
file, then directs the agent to "create one where the agent already reads them" —
the place is identified by files that, by the branch's own precondition, do not
exist.

Suggested fix: name the file names to glob for, define "nearest" concretely
(directory containing the lesson's evidence, walking up), and name the default file
and location for the create case.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ 🟡 F14 — No branch for a rule that already exists or contradicts one

<details>
<summary>Description</summary>

`SKILL.md:53-55`:

> Rules land as
> imperative bullets inside an existing section with the reason embedded in the
> bullet; a new section earns its place only when no section fits.

The skill's main case is appending to an instruction file the agent already reads,
so meeting a bullet that says the same thing — or the opposite — is routine, not
exotic. Nothing tells the agent whether to amend the existing bullet, skip the
duplicate, or raise the conflict with the user before writing. Step 4's check
(`SKILL.md:69-70`, "destinations contain exactly the approved set") gives no help:
it cannot distinguish a merged rule from a missing one.

Suggested fix: add a pre-write reconciliation branch — duplicate → strengthen the
existing bullet instead of adding one; contradiction → stop and put both texts to
the user.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ ⚪ F15 — Verification command is narrower than the step implies; committing is never instructed

<details>
<summary>Description</summary>

`SKILL.md:65-67`:

> Re-read each changed region and run `git diff --check`. Rules ship as their own
> docs commit, separate from feature work. Report the final wording and commit id
> per rule.

`git diff --check` reports whitespace errors and conflict markers in *unstaged*
changes only; once the rule files are staged it prints nothing and exits 0 (verified
by running it read-only in this repository: clean tree, exit code 0). It says
nothing about whether the rule text landed correctly, which is what step 4 is for.
The step also never instructs staging or creating the commit — the commit exists
only by implication from "commit id per rule" — and "docs commit" is an undefined
term for repositories without that convention.

Suggested fix: instruct the write → review → stage → commit sequence explicitly, and
use `git diff --check` (or `--cached` after staging) for what it actually covers.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`; command behaviour
  confirmed with a read-only `git --no-pager diff --check` run (exit 0, no output).

</details>

### ⏳ ⚪ F16 — Git is assumed with no branch for a non-repository destination

<details>
<summary>Description</summary>

Step 4 is written entirely in git terms (`SKILL.md:63-67`, heading "## 4. Verify and
commit", `git diff --check`, "docs commit", "commit id per rule") and its exit
requires them (`SKILL.md:69-70`):

> **Ready when:** destinations contain exactly the approved set, and the user holds
> the commit ids.

Step 3 can legitimately write outside a repository — a host-level or user-level
instruction file is exactly "where the agent already reads them" (`SKILL.md:53`) —
and in that case step 4 has neither a verification command nor a satisfiable exit.

Suggested fix: add the non-git completion path (re-read and report the path and
final wording) or declare non-repository destinations out of scope.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ⏳ ⚪ F17 — Routing has no branch for an ask spanning both live and past sessions

<details>
<summary>Description</summary>

`SKILL.md:14-15`:

> **Past sessions:** When the ask spans session history rather than the live
> session, follow [research-mode.md](research-mode.md).

"rather than" makes the two modes exclusive, but "preserve what we learned today
and check whether earlier sessions hit the same thing" is a natural ask with no
defined route. Nor does the text say whether research mode replaces step 1 or runs
alongside it — `research-mode.md:4` only states that it "feeds step 2".

Suggested fix: one sentence covering the combined ask (run step 1 on the live
session, research mode for history, merge into a single step 2 proposal).

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`. Link target verified:
  `skills/extract-rules/research-mode.md` exists in the same directory, so the
  relative link resolves and satisfies the self-sufficiency rule.

</details>

### ⏳ ⚪ F18 — Research mode carries no exit criteria

<details>
<summary>Description</summary>

Every step in `SKILL.md` ends with a checkable exit — `**Ready when:**` at lines
28, 42, 60, and 69. None of research mode's four stages does: `## Locate the
transcripts` (`research-mode.md:7`), `## Scan` (`research-mode.md:22`), `## Fleet`
(`research-mode.md:33`), `## Aggregate` (`research-mode.md:46`). The file ends at
line 53 with the aggregate's contents and no completion statement:

> Working artifacts stay out of version control;
> the rules or skill the research feeds are what gets committed.

So nothing says when the scan is exhaustive enough, what session coverage counts as
done, when the fleet has reported completely, or what the concrete handoff into
step 2 looks like beyond `research-mode.md:4` ("research feeds step 2").

Suggested fix: give each stage a "Ready when" in the same form as SKILL.md, and end
the file with the explicit return instruction into step 2.

</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0`.

</details>

### ❓ 🟡 F19 — Unclear whether user-supplied rule text bypasses the gate

<details>
<summary>Description</summary>

`SKILL.md:12`:

> When the user supplies the rule text already, carry it straight to step 3.

This sits against the stated invariant (`SKILL.md:9-10`, "Lessons are **proposed**;
only approved ones are **persisted**") and against `research-mode.md:3-5` ("The
propose-then-persist gate still holds"). Reading A: supplied text is self-approved,
so step 3 writes it immediately, no evidence anchor and no numbered proposal.
Reading B: the shortcut only skips the *gathering*, and the text still needs a
proposal, a destination, and evidence before it lands. Step 3 itself points both
ways (`SKILL.md:57-58`): "Offer a wording stage when the user engages on phrasing or
supplies a rule seed" — a *seed* is plainly not finished text, yet line 12 sends
both down the same path, and it is unstated whether step 3's validation
(`SKILL.md:47`) applies to supplied text.

What was tried: re-read both files end to end; searched the repository for an
authoring note or precedent (`AGENTS.md`, `README.md`, sibling skills) — none
addresses the shortcut. The text alone does not settle which reading is intended.

What would settle it: the author stating whether supplied rule text counts as
approved, and which of evidence anchoring, destination selection, and validation
still apply on that path.

</details>

<details>
<summary>Status</summary>

State: ❓ Unverified — awaiting triage · Severity: 🟡 Medium

</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:41 — Raised in round 1 review of `8c1e8e0` as unverified; evidence
  attempted (full re-read plus repository search), unsettled.

</details>

## Resolved and discarded

*(none yet — no finding has been fixed or discarded)*
