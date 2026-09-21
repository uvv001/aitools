# Review — skill `web-ui-visual-decomposition`

Instruction review (followability, completeness, internal consistency,
referenced paths) of `skills/web-ui-visual-decomposition/`: `SKILL.md`,
`decomposition-format.md`, `inspector-brief.md`. Read-only round; no skill
file was modified.

**Reviewed state (pinned)**

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/web-ui-visual-decomposition` → empty output (no local modifications; the reviewed text is the committed text)
- Last commit touching the directory: `6f9c0d3b39a1b2795b7383f0bb296de1a49fba16` (2026-09-14, `skill: web-ui-spec-authoring (#8)`)
- This report lives in `.ai/reviews/`, which `.gitignore` excludes (`/.ai/`); it is deliberately not committed.

## Dashboard

**Fix progress** — 0 findings marked 🔧, against 0 approved and still awaiting
a fix (nothing triaged yet).

**Triage state** — 21 findings, all ⏳ Awaiting triage. One of them (F6) also
carries ❓ because part of its evidence could not be settled from the
repository alone. 0 ✅, 0 ❌, 0 📌, 0 🔀.

Severity spread: 🔴 4 · 🟡 13 · ⚪ 4.

## Checked and found clean

- **Self-sufficiency (root `AGENTS.md` rule).** The skill points at no sibling
  skill file. Its only links are `[inspector-brief.md](inspector-brief.md)`
  (`SKILL.md:32`) and `[decomposition-format.md](decomposition-format.md)`
  (`SKILL.md:53`); both files exist in the directory. The pipeline neighbours
  are named as concepts, not paths: "specification and implementation begin
  outside this skill" (`SKILL.md:60-61`), and the `web-ui-inspector` agent is
  referenced by name with a deliberate in-directory duplicate of its contract —
  "This duplicates the agent contract on purpose — the skill works with the
  agent absent." (`inspector-brief.md:5-6`). No violation of the repository
  rule was found.
- **Frontmatter.** `name: web-ui-visual-decomposition` (`SKILL.md:2`) matches
  the directory name; the description carries a trigger.
- **No referenced script or command.** The skill invokes no executable; there is
  nothing to verify beyond the two relative links above.

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: `skills/web-ui-visual-decomposition/SKILL.md:16-17,29-40`<br>State: ⏳ Awaiting triage<br>The captures-only ("mockup") reference the skill advertises has no observation path: every dispatch and exit criterion assumes a live page. |
| F2 | Severity: 🔴 High<br>File: `skills/web-ui-visual-decomposition/decomposition-format.md:35-37`<br>State: ⏳ Awaiting triage<br>§3 demands a verdict from a five-term set that no protocol step produces and no file defines. |
| F3 | Severity: 🔴 High<br>File: `skills/web-ui-visual-decomposition/SKILL.md:39-40`<br>State: ⏳ Awaiting triage<br>A BLOCKED element is a legal outcome of Observe but has no downstream branch in Map, Write, the document format, or the Gate. |
| F4 | Severity: 🔴 High<br>File: `skills/web-ui-visual-decomposition/SKILL.md:45-51,65-68`<br>State: ⏳ Awaiting triage<br>Decide consumes an open-question register that no step creates, and mappers "return the verdict alone" so their questions never reach the orchestrator. |
| F5 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:36-38,45-47`<br>State: ⏳ Awaiting triage<br>"the working folder" and the part-file location are never defined inside the skill. |
| F6 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:36-38`<br>State: ❓ Unverified — ⏳ awaiting triage<br>"Inspectors are read-only" sits against a brief that tells the worker to write screenshots and payload files; capture destination is unstated while the format expects captures beside the document. |
| F7 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:29-30`<br>State: ⏳ Awaiting triage<br>"the project's declared floor" names an artifact the Inputs list never collects, so the fallback condition is untestable. |
| F8 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:70-72`<br>State: ⏳ Awaiting triage<br>"Report variants; pin later" contradicts the measured-value requirements in the same protocol and in the document format. |
| F9 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/decomposition-format.md:39-42`<br>State: ⏳ Awaiting triage<br>§4 "Data and services" has no producing step, and its conditional existence contradicts the Write exit "every section exists". |
| F10 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/decomposition-format.md:44-47`<br>State: ⏳ Awaiting triage<br>The decision-ledger example contradicts the "numbered" rule and shows no form for a parked question. |
| F11 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:80-81`<br>State: ⏳ Awaiting triage<br>"flagged unverified or moved to the out-of-scope list" offers two outcomes with no selection rule, and the format defines no "unverified" flag. |
| F12 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:26-32`<br>State: ⏳ Awaiting triage<br>"element" granularity is never defined, so fleet size, nesting, and the Frame exit criterion are all unfixed. |
| F13 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:43-44`<br>State: ⏳ Awaiting triage<br>Adoption targets are required output but have no slot in the document format, so the handoff drops them. |
| F14 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/decomposition-format.md:49-52`<br>State: ⏳ Awaiting triage<br>§6's status set (new / extension / reuse) has no value for the "rename" verdict the protocol and §3 both allow. |
| F15 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/decomposition-format.md:49-52`<br>State: ⏳ Awaiting triage<br>Part files are "numbered" at Map time while §6 numbering must match an implementation order decided later; the ordering of §3 is unspecified. |
| F16 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:58-61`<br>State: ⏳ Awaiting triage<br>The Gate exit does not say whether approval is per section or whole-document, nor whether parked questions may remain open at approval. |
| F17 | Severity: 🟡 Medium<br>File: `skills/web-ui-visual-decomposition/SKILL.md:29-30`<br>State: ⏳ Awaiting triage<br>Responsive/multi-viewport coverage is neither instructed nor declared out of scope, while the brief and format both hint at it. |
| F18 | Severity: ⚪ Low<br>File: `skills/web-ui-visual-decomposition/SKILL.md:58-61`<br>State: ⏳ Awaiting triage<br>No back-edge: gate feedback that expands scope or invalidates observations has no named return step. |
| F19 | Severity: ⚪ Low<br>File: `skills/web-ui-visual-decomposition/inspector-brief.md:10-13`<br>State: ⏳ Awaiting triage<br>The duplicated brief drops the agent's "a missing reference or path-to-state is the report" rule, so the two dispatch paths diverge. |
| F20 | Severity: ⚪ Low<br>File: `skills/web-ui-visual-decomposition/SKILL.md:21-22`<br>State: ⏳ Awaiting triage<br>"Paths to state" is listed as an unconditional input although it is inapplicable to a captures-only reference. |
| F21 | Severity: ⚪ Low<br>File: `skills/web-ui-visual-decomposition/SKILL.md:30-32`<br>State: ⏳ Awaiting triage<br>"when installed" has no defined test for deciding between the agent and the brief-carrying subagent. |

## Findings

### ⏳ 🔴 F1 — Captures-only reference has no observation path

<details>
<summary>Description</summary>

The skill advertises a mockup input — `SKILL.md:3`: "description: Decomposes a
mockup or live UI into an approved component plan." — and the Inputs list
accepts a reference with no live page (`SKILL.md:16-17`):

```
- **Reference** — live URL, static captures, or both. Both is the strong
  form: captures anchor the layout, the live page answers state questions.
```

Every downstream instruction then assumes a live page. `SKILL.md:33-34`: "Drive
the live reference to each state before measuring, and visit multiple
occurrences of an element". The dispatch template requires a URL in its subject
slot (`inspector-brief.md:10`): "**SUBJECT** — URL plus the single element to
observe." The worker contract requires page-derived numbers
(`inspector-brief.md:22-24`): "Measure: every reported value is a number read
from the page — computed styles (px, rgb) and bounding-rect geometry including
clipping and overflow." And the Observe exit demands them (`SKILL.md:39-40`):
"**Ready when:** every element carries measured values and a per-state matrix,
or a BLOCKED entry naming its cause."

With captures only, no instruction says how to satisfy this — the only legal
outcome left is a BLOCKED entry for every element in the inventory, which
terminates the skill without a plan. The branch is never declared out of scope
either; `inspector-brief.md:50-51` even assumes the live case ("For
decomposition dispatches, subject and reference are usually the same page").

Suggested fix: either state the captures-only procedure (what a measurement is
when read off an image, which state-matrix rows are structurally unreachable and
default to UNKNOWN), or restrict the Inputs and the frontmatter description to a
live reference and send captures-only work elsewhere.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Verified by reading all three files end to end:
  no captures-only measurement rule exists in any of them.
</details>

### ⏳ 🔴 F2 — §3's element-verdict vocabulary is undefined and unproduced

<details>
<summary>Description</summary>

The document format requires two verdicts per element
(`decomposition-format.md:35-37`):

```
One subsection per inventoried element: verdict (supported / scope-reduced /
renamed / merged / new-missed), the measured evidence, the codebase mapping
(reuse / extend / rename / extract-new, with paths), and inline decisions.
```

The protocol produces only the second set (`SKILL.md:41-43`): "Dispatch a second
**fleet**, one mapper per element: search the codebase for composition fits and
record a verdict — reuse as-is, extend, rename, or extract-new." Its exit
criterion speaks of a single verdict (`SKILL.md:48`): "**Ready when:** every
element has a verdict backed by file-level evidence."

A repository-wide search for `scope-reduced` and `new-missed` returns only
`decomposition-format.md:35-36`; the terms are never defined. Their probable
meaning (status of the element relative to the user's optional proposed
structure, `SKILL.md:19-20`) is guesswork, and when no proposed structure was
supplied the set has no defined mapping at all. An agent assembling §3 from
mapper part files cannot fill a field no worker was asked to produce.

Note this also breaks the format's own convention (`decomposition-format.md:15`):
"One term per concept across the whole document."

Suggested fix: define the five terms and name the step that assigns them (Frame
or Map), or drop the first verdict and keep the codebase mapping alone.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Verified with a case-insensitive repository grep for
  `scope-reduced|new-missed`: only the two format lines match.
</details>

### ⏳ 🔴 F3 — BLOCKED elements have no downstream branch

<details>
<summary>Description</summary>

Observe may legally end with a blocked element (`SKILL.md:39-40`):

```
   **Ready when:** every element carries measured values and a per-state
   matrix, or a BLOCKED entry naming its cause.
```

The workers produce that state too (`inspector-brief.md:35-36`): "Then an
UNKNOWN list (anything not directly observed) and a BLOCKED list (unreachable
states, with causes)."

Nothing downstream accepts it. Map requires evidence per element
(`SKILL.md:48`): "every element has a verdict backed by file-level evidence".
Write requires traceability (`SKILL.md:56-57`): "every section exists and every
claim traces to an observation or a code path". The document format has no
BLOCKED destination anywhere: §2 admits only two states
(`decomposition-format.md:29-30`) — "Every row comes from observation or carries
UNKNOWN." — and §5 hosts questions, not blocked observations
(`decomposition-format.md:47`): "Parked questions stay open with their blocker
named."

So a blocked element is a dead end: it cannot be measured, cannot be written as
an observation, and no rule says whether it blocks approval at the Gate, becomes
UNKNOWN, becomes a parked question, or leaves the scope.

Suggested fix: name the destination — e.g. a BLOCKED element becomes a parked
question in §5 with its cause and is called out in §1's scope boundary — and
state whether the Gate can approve with BLOCKED entries outstanding.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Cross-checked `decomposition-format.md` end to end
  for the token BLOCKED: it does not appear in the file.
</details>

### ⏳ 🔴 F4 — Decide consumes a question register that no step creates

<details>
<summary>Description</summary>

Step 4 assumes a set of open questions already exists (`SKILL.md:49-51`):

```
4. **Decide.** Resolve open questions from the evidence; park the rest as
   explicit questions for the user.
   **Ready when:** every question is decided or parked — none left implicit.
```

No earlier step instructs anyone to record questions. Frame and Observe
(`SKILL.md:26-40`) produce an inventory and measurements. Map lets mappers raise
alternatives — `SKILL.md:44-45`: "Propose better names, splits, or behavior
changes when the reference demands them." — but the same step then withholds
them from the orchestrator (`SKILL.md:45-47`): "Each mapper writes its element's
evaluation to a numbered part file and returns the verdict alone; you assemble
the parts." The guardrail reinforces the withholding (`SKILL.md:67-68`):
"Assemble by concatenating parts, and read one back only when the write needs
it."

An orchestrator that follows these instructions literally reaches step 4 holding
verdicts and no questions, yet must certify "none left implicit" — an exit
criterion it has no way to evaluate, since the questions sit unread in part
files.

Suggested fix: make the question register an explicit artifact — mappers and
inspectors return `verdict + questions raised`, the orchestrator appends them to
a running ledger file, and step 4 works from that file.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Re-read steps 1–3 and the guardrails to confirm no
  step names a question list, an open-questions file, or a return field for one.
</details>

### ⏳ 🟡 F5 — "The working folder" and part-file location are undefined

<details>
<summary>Description</summary>

Two artifact classes are written to unnamed places. `SKILL.md:36-38`:

```
   missed: add them to the inventory and dispatch for them. Inspectors are
   read-only, so persisting each report to the working folder as it lands is
   your job.
```

and `SKILL.md:45-47`: "Each mapper writes its element's evaluation to a numbered
part file and returns the verdict alone; you assemble the parts."

Neither "the working folder" nor the part-file path is defined anywhere in the
three files; the only path the skill fixes is the deliverable's
(`decomposition-format.md:3`): "One markdown file in `docs/` at the project
root". The definite article ("the working folder") implies a convention the
installed skill does not carry — the term is defined only in sibling skills
(`skills/review-with-docs/SKILL.md:80` names `.ai/` as the ignored working
folder), which the root `AGENTS.md` says cannot be relied upon: "Skills install
one at a time, so a pointer into a sibling skill's files breaks whenever that
sibling is absent — duplicate the few lines you need instead of linking."

Consequence: two fleets write files with no root, no naming rule, and no
collision rule between the inspector fleet and the mapper fleet.

Suggested fix: state the folder and the file names inside this skill, e.g.
`.ai/<feature>-decomposition/NN-<element>-inspection.md` and
`NN-<element>-evaluation.md`, and say that NN comes from the inventory.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Grep for "working folder" across the repository:
  defined nowhere inside this skill directory.
</details>

### ❓ 🟡 F6 — "Inspectors are read-only" vs. captures the brief tells them to write

<details>
<summary>Description</summary>

`SKILL.md:36-38` justifies the orchestrator's persistence duty with a property
of the workers: "Inspectors are read-only, so persisting each report to the
working folder as it lands is your job."

The brief handed to those same workers instructs them to produce files:
`inspector-brief.md:24` — "Capture each state as a screenshot; zoom for
pixel-level disputes." — and `inspector-brief.md:47-48` — "Large payloads
(assets, base64) go from the page straight to a file; inline script output
truncates silently."

Two gaps follow. (1) The reader cannot tell whether a worker may write captures
at all, and if it may, the "read-only" premise is only half true. (2) The
capture destination is never stated, while the format expects captures to end
up next to the deliverable (`decomposition-format.md:3-5`): "One markdown file
in `docs/` at the project root, named for the feature and dated from the clock
at creation (`yyyy-mm-dd-<feature>-decomposition-plan.md`), beside the captures
it cites." No step moves or copies captures beside the document, and §1 requires
the document to cite them (`decomposition-format.md:20`): "Sources (live URL,
capture files), scope in and out, a one-line purpose, the approval line."

Unverified part: whether the `web-ui-inspector` agent is in fact tool-restricted
to read-only. `agents/web-ui-inspector.md` declares no tool allow-list (frontmatter
is `name` + `description` only, lines 1-7), and the runtime's agent listing gives
it no read-only label the way it does for built-in read-only agents. Settling it
needs the agent's runtime tool configuration or a trial dispatch — neither is
available in a read-only review of this repository.

Suggested fix: say who writes captures, to which folder, and how they reach the
`docs/` location the format assumes; drop or qualify the "read-only" premise.
</details>

<details>
<summary>Status</summary>

❓ Unverified (agent tool permissions) · ⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Tried: read `agents/web-ui-inspector.md` in full —
  no tool restrictions declared; compared with the runtime agent list, which
  labels other agents read-only but not this one. Would settle it: the agent's
  tool allow-list, or one dispatch observing whether it can write a file.
</details>

### ⏳ 🟡 F7 — "The project's declared floor" is an uncollected input

<details>
<summary>Description</summary>

`SKILL.md:29-30`:

```
2. **Observe.** Declare a fixed viewport (the project's declared floor, else
   1280×720) and dispatch a **fleet**: one inspector per element — the
```

"the project's declared floor" names an artifact the skill never collects: the
Inputs list (`SKILL.md:16-22`) has Reference, Scope, Proposed structure, Paths
to state — no conventions or project-standards file. There is no instruction on
where a declared viewport floor would live, so the "else" branch cannot be
evaluated: an agent either invents a search or silently defaults to 1280×720,
and two runs on the same project can legitimately differ. The viewport then
propagates into the deliverable (`decomposition-format.md:26-27`: "Screen
anatomy with measured geometry (column widths in px at the declared
viewport).").

Suggested fix: add the conventions/standards file to Inputs (with "ask where any
is missing" already covering absence, `SKILL.md:14`), or say explicitly "ask the
user for the project's minimum supported viewport; default 1280×720 if the user
has none."
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Verified the Inputs list contains no conventions
  file and that no other line in the three files defines where a floor is declared.
</details>

### ⏳ 🟡 F8 — "Report variants; pin later" contradicts the measurement requirements

<details>
<summary>Description</summary>

The guardrail defers precision (`SKILL.md:70-72`):

```
- **Report variants; pin later.** Describe elements with examples and their
  available variants; value pinning belongs to the specification stage.
  Research-stage precision reads as commitment and invites rework.
```

The protocol and the format demand precision in the same breath. `SKILL.md:39-40`:
"every element carries measured values and a per-state matrix".
`decomposition-format.md:26-30`: "Screen anatomy with measured geometry (column
widths in px at the declared viewport). ... Behavior table: interaction →
observed behavior, with measured values (colors as rgb, sizes as px)."
`decomposition-format.md:36`: "the measured evidence".

Nothing tells the agent which numbers belong in the plan and which are withheld
for the specification stage, so the guardrail and the exit criteria point in
opposite directions on the same artifact — a writer will either strip measured
values the format requires or record values the guardrail calls premature
commitment.

Suggested fix: draw the line explicitly — observations are recorded with their
measured numbers; what is deferred is the *choice* among variants (which token,
which size a new component adopts), not the measurement.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Re-read guardrails and §2/§3 of the format to
  confirm no reconciling sentence exists.
</details>

### ⏳ 🟡 F9 — §4 has no producing step and contradicts the Write exit

<details>
<summary>Description</summary>

`decomposition-format.md:39-42`:

```
## 4. Data and services

Only when the feature fetches: the data-layer shape, fixture strategy, and
state ownership, matched to the project's existing patterns.
```

No protocol step gathers this. Observe measures rendered values
(`inspector-brief.md:22-24`); Map searches for "composition fits"
(`SKILL.md:41-42`); neither covers fixture strategy or state ownership, and the
skill never tells anyone to inspect the data layer or the project's existing
data patterns.

The conditional section also collides with the Write exit criterion
(`SKILL.md:56-57`): "**Ready when:** every section exists and every claim traces
to an observation or a code path." For a non-fetching feature, "every section
exists" is false by the format's own rule — the criterion is unsatisfiable as
written.

Suggested fix: add the data/service research to Map (or a named sub-step) for
fetching features, and reword the Write exit to "every applicable section
exists, and sections the format makes conditional are present or explicitly
marked not applicable".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Walked all six steps checking for a data-layer
  instruction; none found.
</details>

### ⏳ 🟡 F10 — Decision-ledger example contradicts its rule and omits the parked form

<details>
<summary>Description</summary>

`decomposition-format.md:44-47`:

```
## 5. Decision ledger

Every open question, numbered: `~~Q — question~~ **Decided**: resolution and
reason`. Parked questions stay open with their blocker named.
```

The rule says "numbered", the example shows a bare `Q` with no number, so the
numbering scheme (Q1…, per-section, document-wide) is left to invention. The
example also illustrates only the decided case; for the parked case — the one
step 4 explicitly produces (`SKILL.md:49-50`: "park the rest as explicit
questions for the user") — no form is given, and the strikethrough convention
visibly belongs to the decided case, so an agent cannot tell what a parked entry
looks like.

A further mismatch: the format says a parked question carries a "blocker", while
the protocol parks questions that merely await the user's choice, which is not
obviously a blocker.

Suggested fix: show both forms, e.g. `Q3 — question` → **Parked**: what it waits
on, and `~~Q3 — question~~` → **Decided**: resolution and reason; state that
numbering is document-wide and stable.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Verified the example is the only ledger syntax in
  the three files.
</details>

### ⏳ 🟡 F11 — "Flagged unverified or moved to out-of-scope" has no selection rule

<details>
<summary>Description</summary>

`SKILL.md:80-81`:

```
- **Spec only what the reference shows.** An element with no occurrence in
  the reference is flagged unverified or moved to the out-of-scope list.
```

Two outcomes, no rule for choosing between them, and they are not equivalent:
the out-of-scope list is part of the document's boundary
(`decomposition-format.md:20-22`), while an "unverified" flag keeps the element
in the plan. Worse, the format defines no "unverified" flag — its vocabulary is
UNKNOWN for unobserved behavior (`decomposition-format.md:29-30`) and the §3
verdicts (`decomposition-format.md:35-37`). A repository grep finds "unverified"
in this skill only at `SKILL.md:81`.

An agent therefore has to invent both the decision rule and the notation.

Suggested fix: pick one outcome as default (e.g. such an element goes to the
out-of-scope list unless the user asked for it, in which case it becomes a
parked question in §5) and reuse the format's existing UNKNOWN vocabulary rather
than a third word.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Grep for `unverified` across the repository: inside
  this skill it occurs only on `SKILL.md:81`.
</details>

### ⏳ 🟡 F12 — "Element" granularity is never defined

<details>
<summary>Description</summary>

The unit of work for both fleets is "element". `SKILL.md:26-32`:

```
1. **Frame.** Enumerate the screen's elements from the reference, merging in
   the proposed structure, and give each a working name.
   **Ready when:** every visible element sits in the inventory.
2. **Observe.** Declare a fixed viewport (the project's declared floor, else
   1280×720) and dispatch a **fleet**: one inspector per element — the
```

Nothing defines the granularity: whether a button inside a card is its own
element, whether nested elements are dispatched separately or measured within
their parent, or how a repeated row relates to the list that holds it. The
decision drives fleet size (one inspector plus one mapper per element,
`SKILL.md:30,41`), the number of part files, and the number of §3 subsections
(`decomposition-format.md:35`: "One subsection per inventoried element").

The Frame exit criterion inherits the problem: "every visible element sits in
the inventory" cannot be checked without a rule for what counts as one, and it
is stated as a completeness claim the agent cannot prove from a reference it has
not yet measured (Observe explicitly expects misses: `SKILL.md:35-36`,
"Observation reveals elements the frame missed").

Suggested fix: define the unit — e.g. "an element is a candidate component: a
structure with its own states or its own reuse story; nested structures become
their own elements only when they carry states of their own" — and note the
parent/child dispatch rule.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Checked all three files for a definition of
  "element"; the closest is the guardrail on naming (`SKILL.md:76-77`), which
  addresses names, not granularity.
</details>

### ⏳ 🟡 F13 — Adoption targets have no slot in the document format

<details>
<summary>Description</summary>

Map requires them (`SKILL.md:43-44`):

```
   rename, or extract-new. Where a new shared component replaces an existing
   custom structure, name the adoption targets. Propose better names, splits,
```

The format's §3 lists the fields a subsection carries and adoption targets are
not among them (`decomposition-format.md:35-37`): "verdict (…), the measured
evidence, the codebase mapping (reuse / extend / rename / extract-new, with
paths), and inline decisions." §6's table has no column either
(`decomposition-format.md:51`): "Table: `# | component | location | status`".

So a required Map output has no defined home in the deliverable, and the next
stage — which expects the plan to carry "the existing structures each new
component replaces" — receives it only if the writer improvises a field.

Suggested fix: add "adoption targets (paths this component replaces)" to the §3
field list so assembly preserves it.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Grep for "adoption target": one hit,
  `SKILL.md:44`; the format never mentions it.
</details>

### ⏳ 🟡 F14 — §6's status set has no value for a "rename" verdict

<details>
<summary>Description</summary>

`decomposition-format.md:49-52`:

```
## 6. Component summary

Table: `# | component | location | status` where status is new, extension,
or reuse. Numbering matches the implementation order.
```

The verdict vocabulary upstream has four values (`SKILL.md:42-43`: "reuse
as-is, extend, rename, or extract-new"; mirrored at
`decomposition-format.md:36-37`). Mapping is unstated and one value has no
target: an element whose verdict is "rename" is neither new, nor an extension,
nor plain reuse. The writer must either invent a status or silently misfile it,
against the format's own convention (`decomposition-format.md:15-16`): "One term
per concept across the whole document. When two terms collide, unify them and
record the choice as a decision."

Suggested fix: use one vocabulary in both places, or state the mapping
explicitly (extract-new → new, extend → extension, rename → …, reuse as-is →
reuse).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Cross-read `SKILL.md:41-48` against
  `decomposition-format.md:33-52`; no mapping rule exists.
</details>

### ⏳ 🟡 F15 — Part-file numbering vs. implementation-order numbering

<details>
<summary>Description</summary>

Mappers number their outputs during step 3 (`SKILL.md:45-47`): "Each mapper
writes its element's evaluation to a numbered part file and returns the verdict
alone; you assemble the parts." Step 5 assembles them in that form
(`SKILL.md:52-55`): "assemble the mappers' part files as the item-by-item
evaluation".

But the document's numbering must express an order decided later
(`decomposition-format.md:52`): "Numbering matches the implementation order." —
where that order is produced only in §7 (`decomposition-format.md:54-57`):
"Simplest to most complex; each step's output is consumed by later steps; shared
components land before the feature assembly that consumes them."

Unstated: what the part-file numbers mean at Map time (inventory order?),
whether §3 subsections must be re-sequenced into implementation order after §7
is written, and whether §6's numbers are expected to agree with the §3 order.
An agent that concatenates parts in their original numbering produces a document
whose §3 and §6 numberings disagree.

Suggested fix: say that part-file numbers are provisional inventory indices and
that §6/§7 numbering is assigned at Write time, naming whether §3 is re-ordered
to match.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Verified that no line defines the part-file
  numbering source.
</details>

### ⏳ 🟡 F16 — Gate exit criterion is ambiguous

<details>
<summary>Description</summary>

`SKILL.md:58-61`:

```
6. **Gate.** Present the document, revise, and re-present until the user
   approves. An edit to approved content clears that section's mark.
   **Ready when:** approval is explicit; specification and implementation
   begin outside this skill.
```

Two ambiguities. (1) Granularity: the exit speaks of one approval of "the
document", while the format tracks approval per section
(`decomposition-format.md:13-14`): "A section the user approves carries ✅ in its
heading. When approved content changes, the mark comes off until re-approved."
Whether the skill exits on a single whole-document approval or requires ✅ on
every section is not stated, and "that section's mark" (`SKILL.md:59`) presumes
the per-section scheme without naming the ✅ convention that defines it.
(2) Parked questions: step 4 may legitimately leave questions open
(`SKILL.md:49-51`), and nothing says whether the document can be approved while
they remain, or whether the Gate is where they get answered.

Suggested fix: state the exit as "every section carries ✅ and every parked
question is either answered at the gate or explicitly accepted as open by the
user".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Confirmed the ✅ convention exists only in
  `decomposition-format.md:13-14` and is referenced obliquely as "mark" in SKILL.md.
</details>

### ⏳ 🟡 F17 — Responsive coverage neither instructed nor declared out of scope

<details>
<summary>Description</summary>

Observation is fixed to one viewport (`SKILL.md:29-30`): "Declare a fixed
viewport (the project's declared floor, else 1280×720)". Yet the artifacts
around it anticipate multiple layouts: the state matrix names layout-dependent
states (`inspector-brief.md:19-20`: "plus every state the dispatch names
(collapsed, overflowing, offline, dark mode)"), and the format asks for
per-variant content (`decomposition-format.md:31`: "Per-variant content and data
shapes, where the screen has modes.").

Whether a responsive screen is decomposed at one viewport only, or gets a second
pass at a narrow width, is never decided, and the guardrails do not declare
multi-viewport work out of scope. For a UI decomposition this is a realistic
condition rather than an exotic one — an agent will either miss the mobile
layout or silently double the fleet.

Suggested fix: one sentence either way — "one viewport per decomposition;
additional breakpoints are a separate dispatch set named in scope" or "declare
each breakpoint in scope and dispatch the fleet per breakpoint".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Checked Inputs, Protocol and Guardrails for any
  breakpoint rule; none present.
</details>

### ⏳ ⚪ F18 — No back-edge when gate feedback invalidates earlier work

<details>
<summary>Description</summary>

`SKILL.md:58-59`: "Present the document, revise, and re-present until the user
approves." The loop is stated only over presentation. When the user's feedback
adds an element to scope, removes one, or contradicts an observation, no step is
named as the return point — steps 1–3 own inventory, measurement and mapping,
but the Gate never points back at them. Compare the in-step loop Observe does
define (`SKILL.md:35-36`): "Observation reveals elements the frame missed: add
them to the inventory and dispatch for them."

Suggested fix: add "scope changes at the gate re-enter at Frame; a contested
measurement re-enters at Observe for that element alone".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised.
</details>

### ⏳ ⚪ F19 — The brief drops the agent's missing-reference rule

<details>
<summary>Description</summary>

`inspector-brief.md:10-13` defines the dispatch slots:

```
- **SUBJECT** — URL plus the single element to observe.
- **REFERENCE** — live URL and/or capture, with the path to each state.
- **VIEWPORT** — declared per dispatch.
- **SCOPE EXCLUSIONS** — what to ignore.
```

The agent contract it duplicates carries a rule the brief omits
(`agents/web-ui-inspector.md:22-23`): "A missing reference or path-to-state is
the report: return the gap rather than inspecting around it." Since the skill
routes work down either path (`SKILL.md:30-32`), a dispatch with a missing
path-to-state behaves differently depending on which worker ran it — the agent
returns the gap, the brief-carrying subagent has only the generic BLOCKED rule
(`inspector-brief.md:30-31`) to fall back on.

Suggested fix: copy the missing-reference sentence into the brief's slots
section; duplication is the repository's prescribed remedy.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised. Diffed the brief against
  `agents/web-ui-inspector.md` line by line; this is the one contract rule with
  no counterpart.
</details>

### ⏳ ⚪ F20 — "Paths to state" is listed as an unconditional input

<details>
<summary>Description</summary>

`SKILL.md:14`: "Collect before observing; ask where any is missing." The list
marks exactly one entry optional (`SKILL.md:19`: "**Proposed structure**
(optional)"), while `SKILL.md:21-22` reads:

```
- **Paths to state** — how to reach each non-default state on the live
  reference (roles, click paths, data conditions).
```

Its own text scopes it to a live reference, but the checklist makes it
unconditional, so an agent working from captures alone is instructed to ask the
user for something inapplicable. (Related to F1, which covers the deeper gap.)

Suggested fix: mark it "(live reference only)".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised.
</details>

### ⏳ ⚪ F21 — "When installed" has no defined test

<details>
<summary>Description</summary>

`SKILL.md:30-32`:

```
   1280×720) and dispatch a **fleet**: one inspector per element — the
   `web-ui-inspector` agent when installed, otherwise a subagent carrying
   [inspector-brief.md](inspector-brief.md) as its prompt. One element per
```

and `inspector-brief.md:3-4`: "Use the `web-ui-inspector` agent when installed;
otherwise hand a generic subagent this brief verbatim with the slots filled."

The branch condition names no check. An agent can usually list available agent
types, but the instruction does not say so, and an attempted dispatch of a
missing agent is a failure path with no stated handling.

Suggested fix: "list the available agent types; if `web-ui-inspector` is absent,
dispatch a generic subagent with this brief."
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low.
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 10:37 — Raised.
</details>

## Resolved and discarded

None yet — no finding has been triaged.
