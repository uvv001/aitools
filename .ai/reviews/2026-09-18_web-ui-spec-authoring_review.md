# Review — skill `web-ui-spec-authoring` (instructions)

Round 1, 2026-09-18. Read-only review of instruction correctness and
completeness; no skill file was modified.

**Reviewed state**

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/web-ui-spec-authoring` → *(no output — path clean at HEAD)*

**Scope** — `skills/web-ui-spec-authoring/SKILL.md`,
`skills/web-ui-spec-authoring/references/section-brief.md`,
`skills/web-ui-spec-authoring/references/specification-format.md`. Sibling
skills and `agents/web-ui-inspector.md` were read as cross-reference only.

**Report location** — `.ai/reviews/` (git-ignored per `.gitignore:1` `/.ai/`).
Not committed, by instruction.

**Link check** — every intra-skill link resolves: `SKILL.md:41` →
`references/specification-format.md` ✓, `SKILL.md:48` →
`references/section-brief.md` ✓, `section-brief.md:19` →
`specification-format.md` (same directory) ✓. No scripts or commands are
referenced. **No sibling-skill file path is referenced** — the AGENTS.md
`skills/` self-sufficiency rule is not violated by a link; the one
out-of-directory dependency is the `web-ui-inspector` agent (F3, F17).

## Dashboard

**Fix progress** — 0 findings marked 🔧, against 0 approved and awaiting a fix
(no finding has been triaged yet).

**Triage state** — 17 findings, all ⏳ Awaiting triage. One (F17) additionally
carries ❓ Unverified.

Severity spread — 🔴 5 (F1–F5) · 🟡 9 (F6–F14) · ⚪ 2 (F15–F16) · ❓ 1 (F17,
severity 🟡, evidence unsettled). Total 17.

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: skills/web-ui-spec-authoring/SKILL.md:40-46<br>State: ⏳ Awaiting triage<br>The vocabulary ledger is mandated by three files but defined by none — `specification-format.md`, the file step 3 writes "per", never mentions it. |
| F2 | Severity: 🔴 High<br>File: skills/web-ui-spec-authoring/SKILL.md:38-39, 53-55, 78-81<br>State: ⏳ Awaiting triage<br>A state the reference cannot prove gets three conflicting dispositions and no step ever resolves the UNVERIFIED lists before the Gate. |
| F3 | Severity: 🔴 High<br>File: skills/web-ui-spec-authoring/SKILL.md:32-37, 90-94<br>State: ⏳ Awaiting triage<br>Pin's only actor is the out-of-directory `web-ui-inspector` agent, with no "otherwise" branch and no dispatch brief, while a guardrail bans every other browser path. |
| F4 | Severity: 🔴 High<br>File: skills/web-ui-spec-authoring/SKILL.md:53-55<br>State: ⏳ Awaiting triage<br>Step 4's exit criterion demands an API from every part file, contradicting the mechanism-open rule; the brief has no slot telling the worker which rule applies. |
| F5 | Severity: 🔴 High<br>File: skills/web-ui-spec-authoring/SKILL.md:56-62<br>State: ⏳ Awaiting triage<br>Unify may extract a shared component, but no branch adds its inventory row, amends §1's order, or dispatches its section. |
| F6 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/references/specification-format.md:68-69<br>State: ⏳ Awaiting triage<br>§2 must name the verification viewport and showcase surface; no protocol step produces either. |
| F7 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:20-21, 35-36<br>State: ⏳ Awaiting triage<br>Pin requires driving a live reference to each state, but paths-to-state are never collected and a captures-only reference has no branch. |
| F8 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:36-37<br>State: ⏳ Awaiting triage<br>"The working folder" and the part-file directory are undefined, and the spec's own location carries two rules that need not agree. |
| F9 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:17-19<br>State: ⏳ Awaiting triage<br>Only the plan's *decided* questions are handled; a parked question blocking a component has no route. |
| F10 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:76-77<br>State: ⏳ Awaiting triage<br>"Stop and report" has no resume branch: after the user re-decides, nothing re-dispatches the stopped section, so step 4's exit criterion stays unreachable. |
| F11 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:45-46<br>State: ⏳ Awaiting triage<br>Step 3's exit criterion depends on sections that do not exist until step 4, making it uncheckable when it is applied. |
| F12 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:49-51<br>State: ⏳ Awaiting triage<br>Dependency waves need a consumes-graph the declared inputs do not supply, and no step derives or records one. |
| F13 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/references/specification-format.md:101-105<br>State: ⏳ Awaiting triage<br>The Final assembly section has no assigned producer or brief shape, and its per-slice approval conflicts with the whole-document Gate. |
| F14 | Severity: 🟡 Medium<br>File: skills/web-ui-spec-authoring/SKILL.md:30-31, 38-39<br>State: ⏳ Awaiting triage<br>Step 2's exit criterion covers "every state of every component" while step 1 exempts items "recorded as already pinned", leaving their reference locations unsourced. |
| F15 | Severity: ⚪ Low<br>File: skills/web-ui-spec-authoring/references/section-brief.md:44-47<br>State: ⏳ Awaiting triage<br>The 200-word report cap collides with reporting a full API signature that later dispatches must quote verbatim. |
| F16 | Severity: ⚪ Low<br>File: skills/web-ui-spec-authoring/SKILL.md:3<br>State: ⏳ Awaiting triage<br>The trigger says "a plan or decomposition"; the body uses only "approved plan" — the skill's own one-term-per-concept rule. |
| F17 | Severity: 🟡 Medium (unverified)<br>File: skills/web-ui-spec-authoring/SKILL.md:33-34<br>State: ⏳ Awaiting triage · ❓ Unverified<br>Whether `agents/web-ui-inspector.md` installs alongside a skill is undocumented; the answer sets how severe F3's missing fallback is. |

## Findings

### ⏳ 🔴 F1 — Vocabulary ledger is mandated everywhere and defined nowhere

<details><summary><b>Description</b></summary>

`SKILL.md:40-44` sends the author to the format file for the ledger:

> 3. **Frame.** Write §1 and §2 yourself, per
>    [references/specification-format.md](references/specification-format.md).
>    These fix what the fleet cannot negotiate: scope, fixed decisions, the
>    implementation order, and the vocabulary ledger — one term per concept,
>    with the value sets already in use.

`references/specification-format.md` contains neither "ledger" nor
"vocabulary" (verified: `Select-String -Pattern 'vocabul|ledger'` returns only
"flagged" at line 27). Its §1 is `Purpose / Sources table / Scope / Fixed
decisions / Component order` (lines 22-35) and §2 is the implementer's loop
(lines 37-71). The closest statement leaves the destination open
(`specification-format.md:16-17`):

> - One term per concept, and one treatment per shared concern, across the
>   whole document. When two terms collide, unify them and record the choice.

Downstream artefacts assume the ledger survives: `section-brief.md:15-16`
passes it as a dispatch slot, `SKILL.md:58` reconciles coined terms against
it, and the implementation skill pre-seeds workers with "the vocabulary
ledger's terms" (`skills/web-ui-spec-implementation/references/worker-brief.md:29-30`).

So an agent must invent the ledger's home (a §1/§2 subsection? a
working-folder file?), its shape, and how a resolved collision is recorded.

**Fix:** add the ledger to `specification-format.md` as a named subsection of
§1 or §2 with its columns fixed (term, definition, closed value set, superseded
synonyms), and have `SKILL.md:40-46` point at that subsection.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1. Verified by full-text search of
  `specification-format.md` for `vocabul|ledger`: no match.
</details>

### ⏳ 🔴 F2 — A state the reference cannot prove has three dispositions and no resolution step

<details><summary><b>Description</b></summary>

The same condition is handled three different ways, and nothing closes it.

`SKILL.md:38-39` (Pin exit):

> **Ready when:** every state of every component maps to a reference
>    location and a pinned value, or carries an explicit no-reference flag.

`SKILL.md:78-80` (guardrail):

> - **The reference is the oracle.** Every specified state names the place in
>   the reference that proves it. A state the reference never shows goes to
>   the user as a question rather than into the document

`references/section-brief.md:29-31` (worker contract):

> 2. Every state the section names carries the reference location that proves
>    it and the value measured there. A state with neither goes on the
>    UNVERIFIED list instead of into the section.

Flagging, asking the user, and listing as UNVERIFIED are not the same action.
Worse, the UNVERIFIED list is collected and never consumed: `SKILL.md:53-55`
requires "a part file whose report names its API and its UNVERIFIED list",
and steps 5 and 6 (`SKILL.md:56-67`) never mention UNVERIFIED, the
no-reference flag, or user questions again. The document can therefore reach
approval carrying unverifiable states — which the format then pushes onto the
implementer (`specification-format.md:54-57`):

> - **Validate standalone**: build, test, run the showcase surface, and compare
>   every state against the section's reference locations at the verification
>   viewport. A state whose reference cannot be found means the component is
>   not done

Terminology compounds it: the inspector this skill dispatches reports
`UNKNOWN`/`BLOCKED` (`agents/web-ui-inspector.md`), the Pin step says
"no-reference flag", and the brief says "UNVERIFIED" — no mapping is given.

**Fix:** pick one term, and add an explicit disposition step between Draft and
Gate: every UNVERIFIED entry goes to the user as a question, the answer lands
as a fixed decision in §1, and no section reaches Gate with an open entry —
or state that shipping UNVERIFIED entries is allowed and how the implementer
must treat them.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1. Verified that `UNVERIFIED`,
  `no-reference`, and `flag` do not occur in `specification-format.md`.
</details>

### ⏳ 🔴 F3 — Pin's only actor lives outside the skill, with no fallback branch

<details><summary><b>Description</b></summary>

`SKILL.md:32-37`:

> 2. **Pin.** Verify every marked value against the reference: per-state
>    geometry, colors, tokens, content. Dispatch a **fleet** — one
>    `web-ui-inspector` agent per component that needs pinning

and `SKILL.md:90-94` closes every other route:

> Browser access is
>   for pinning values against the reference, dispatched through the
>   `web-ui-inspector` agent.

The agent is `agents/web-ui-inspector.md` — outside
`skills/web-ui-spec-authoring/`. `AGENTS.md:8-11` states the constraint this
repository works under:

> - Keep each skill self-sufficient: reference only files inside its own
>   directory. Skills install one at a time, so a pointer into a sibling skill's
>   files breaks whenever that sibling is absent — duplicate the few lines you
>   need instead of linking.

The pipeline sibling treats that absence as a live case and ships its own
brief (`skills/web-ui-visual-decomposition/SKILL.md:30-32`):

> one inspector per element — the
>    `web-ui-inspector` agent when installed, otherwise a subagent carrying
>    [inspector-brief.md](inspector-brief.md) as its prompt.

This skill has no such branch and no `references/inspector-brief.md`: if the
agent is absent, step 2 has no defined actor, the guardrail forbids measuring
directly, and the protocol dead-ends before §1 is written.

**Fix:** duplicate an inspector brief into
`skills/web-ui-spec-authoring/references/` and rewrite step 2 as "the
`web-ui-inspector` agent when installed, otherwise a subagent carrying
references/inspector-brief.md", with the guardrail widened to match.

See F17 for the unsettled installation question that scales this severity.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1. Verified the skill directory holds
  only `SKILL.md`, `references/section-brief.md`,
  `references/specification-format.md`.
</details>

### ⏳ 🔴 F4 — Step 4's exit criterion contradicts the mechanism-open rule

<details><summary><b>Description</b></summary>

`SKILL.md:53-55`:

> **Ready when:** every inventory item has a part file whose report names
>    its API and its UNVERIFIED list

But a mechanism-open component has no API by design
(`specification-format.md:92-99`):

> Where the plan deliberately left the mechanism to a spike during
> implementation, the section specifies **requirements and consumption
> scenarios, not an API**

`section-brief.md` carries the same collision internally: contract item 1
(lines 26-28) orders the worker to write "reference locations, API, rendering
and accessibility, tokens, tests, showcase, consumer adoption", item 4 (34-35)
orders "every value set a name and a closed union", while the guardrail (57-59)
reverses both:

> - A mechanism the plan left open stays open: specify requirements and
>   consumption scenarios in place of an API

Nothing tells the worker which case it is in: the `COMPONENT` slot
(`section-brief.md:9-10`) offers only "kind (new / extension / reuse)".

**Fix:** add a `MECHANISM` slot (`fixed` / `open`, with the plan's reason),
make contract items 1 and 4 branch on it, and restate `SKILL.md:53-55` as
"names its API — or, for a mechanism-open component, its requirements and
consumption scenarios".
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🔴 F5 — Unify can extract a component, and nothing routes it back into the document

<details><summary><b>Description</b></summary>

`SKILL.md:56-62`:

> 5. **Unify.** Read the sections as a set: ... Reconcile every term a worker
>    coined against the ledger, turn repeated internal structure into a
>    composition proposal, and give a concern several components share one
>    treatment.
>    **Ready when:** every repetition across sections is extracted, composed,
>    or justified in place, and one term survives per concept.

The body produces a *proposal*; the exit criterion accepts *extracted*. Two
questions have no answer: who approves the proposal (the plan's inventory is a
fixed decision per `SKILL.md:76-77`), and what happens to the document once a
new shared component exists. §1's component order is written back in step 3
(`SKILL.md:40-46`) and never revisited; the dispatch fleet closed in step 4;
yet the format requires one section per inventory item
(`specification-format.md:73-77`) and a numbered component order
(`specification-format.md:34-35`). An extracted component would appear in
sections that consume it while having no section, no inventory row, and no
dependency-wave dispatch.

**Fix:** define the branch — the proposal goes to the user; on acceptance, add
the inventory row, amend §1's component order and the ledger, return to step 4
for that component's dispatch, then re-run step 5. On rejection, the repetition
is justified in place.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F6 — No step fixes the verification viewport or the showcase surface

<details><summary><b>Description</b></summary>

The format makes both mandatory content of §2
(`specification-format.md:68-69`):

> - Name the showcase surface and the verification viewport; every visual
>   comparison uses both.

and `specification-format.md:47-51` requires naming a stand-in surface where
the project has no showcase application. The protocol never produces either
value: `SKILL.md:27-46` (Absorb, Pin, Frame) mentions no viewport, and the
Inputs list (`SKILL.md:13-23`) collects only plan, reference, conventions file.
The sibling stage shows the missing line
(`skills/web-ui-visual-decomposition/SKILL.md:29-30`):

> Declare a fixed viewport (the project's declared floor, else
>    1280×720)

Consequence: geometry pinned in step 2 has no declared viewport, so two
inspectors may measure at different widths, and the §2 field is filled by
invention. Downstream depends on it —
`skills/web-ui-spec-implementation/references/process-proposal.md:49-51`:
"The specification's named surface is the starting point; confirm or override
it here. Include the verification viewport when visual comparison applies."

**Fix:** declare the verification viewport in step 1 or 2 (with the sibling's
default rule duplicated, not linked), pass it in every Pin dispatch, and have
step 3 name the showcase surface from the conventions file.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F7 — Pin assumes a live reference and paths to each state, neither guaranteed

<details><summary><b>Description</b></summary>

`SKILL.md:35-36` instructs:

> Drive the live
>    reference to each state before measuring.

while the Inputs permit a reference with no live page at all
(`SKILL.md:20-21`):

> - **Reference** — the live URL, static captures, or both, that the plan
>   observed. Pinning measures against it.

No branch says how pinning proceeds from captures alone. The Inputs also never
collect the routes to non-default states; the sibling stage collects them
explicitly (`skills/web-ui-visual-decomposition/SKILL.md:21-22`):

> - **Paths to state** — how to reach each non-default state on the live
>   reference (roles, click paths, data conditions).

A pinning dispatch sent without them returns gaps instead of measurements.
Secondary: the driving instruction is written to the orchestrator, though the
dispatched inspector is what reaches the states.

**Fix:** add "Paths to state" to Inputs; state the captures-only branch (pin
from captures, flag state coverage the captures cannot show); phrase the
driving instruction as part of the dispatch contract.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F8 — Working folder, part-file location, and the spec's own path are unsettled

<details><summary><b>Description</b></summary>

`SKILL.md:36-37` names a destination the skill never defines:

> Inspectors are read-only, so
>    persisting each report to the working folder as it lands is your job.

Same for part files — `section-brief.md:21-22` fixes the file *name* only:

> - **PART FILE** — the destination, numbered for its place in the order
>   (`NN-<component>.md`), so assembly is concatenation.

Other skills in this repository each define the term locally (for example
`skills/review-with-docs/SKILL.md:80` names an "ignored working folder
(`.ai/`)", `skills/extract-rules/research-mode.md:39,48` writes part files into
"the working folder" and merges them "under the project's ignored" folder), so
there is no repository-wide definition this skill can lean on — and per
`AGENTS.md:8-11` it must carry its own.

Third, the deliverable's location carries two rules that need not coincide
(`specification-format.md:3-5`):

> One markdown file in `docs/` at the project root, named for the feature and
> dated from the clock at creation (`yyyy-mm-dd-<feature>-specification.md`),
> beside the approved plan it implements.

If the approved plan is not in `docs/` (a chat-supplied plan, another
repository, a different folder), "in `docs/` at the project root" and "beside
the approved plan" conflict, and nothing ranks them. Nothing states whether
part files are kept or removed after assembly.

**Fix:** name the working folder and the part-file directory inline in step 2/4,
state the post-assembly disposition of part files, and make "beside the
approved plan" a fallback that applies only when the plan is not in `docs/`.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1. Verified no repository-level
  definition of "working folder" exists (grep across `skills/`).
</details>

### ⏳ 🟡 F9 — The plan's parked questions have no handling

<details><summary><b>Description</b></summary>

The Inputs describe the plan only through its closed questions
(`SKILL.md:17-19`):

> - **Approved plan** — scope in and out, fixed decisions, a component
>   inventory in implementation order, and the existing structures each new
>   component replaces. Its decided questions are closed.

and the format restates only those (`specification-format.md:32-33`):

> - **Fixed decisions** — the plan's decided questions, restated as "do not
>   change".

But the upstream plan format ships open items by design
(`skills/web-ui-visual-decomposition/decomposition-format.md:44-47`):

> ## 5. Decision ledger
>
> Every open question, numbered ... Parked questions stay open with their
> blocker named.

A parked question that governs a component's contract has no defined route:
ask the user before Pin, treat the component as mechanism-open, or drop it from
scope are all plausible and none is stated. The "Fixed decisions stand"
guardrail (`SKILL.md:76-77`) covers a decision that proves *wrong*, not one
that was never taken.

**Fix:** in step 1, add: carry every parked question to the user before Pin;
record each answer as a fixed decision, or mark the affected component
mechanism-open or out of scope.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F10 — "Stop and report" has no resume branch

<details><summary><b>Description</b></summary>

`SKILL.md:76-77`:

> - **Fixed decisions stand.** When a plan decision proves wrong while pinning
>   or writing, stop and report — the user re-decides.

and `section-brief.md:51-52`: "A plan detail that proves wrong stops the
dispatch and is reported." What happens after the user re-decides is unstated:
whether the stopped dispatch is re-briefed with the corrected decision, whether
sibling dispatches in the same wave continue, and whether the corrected
decision is written back into §1. Meanwhile step 4 cannot close
(`SKILL.md:53-55`): "**Ready when:** every inventory item has a part file".

The sibling implementation skill states the equivalent route explicitly
(`skills/web-ui-spec-implementation/SKILL.md:107-111`): "park the component,
put the defect to the user as a design question, carry the decision back into
the specification, and re-brief from the corrected section."

**Fix:** add the return path to the guardrail — record the re-decision in §1's
fixed decisions, re-brief the stopped dispatch from the corrected plan extract,
and state whether in-flight siblings continue or pause.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F11 — Step 3's exit criterion cannot be checked when it applies

<details><summary><b>Description</b></summary>

`SKILL.md:45-46`:

> **Ready when:** §1 and §2 are written, and the ledger names a term for
>    every concept the component sections will share.

The component sections are written in step 4, so at step 3 the set of shared
concepts is unknown, and no method is given for enumerating it in advance (from
the plan's behavior table, the pinning worklist, the reported variants). The
protocol itself assumes the ledger will be incomplete — `SKILL.md:58` has
Unify "reconcile every term a worker coined against the ledger" — which
contradicts a step-3 gate demanding completeness.

**Fix:** restate as a criterion checkable at step 3, e.g. "the ledger names
every term the plan, the fixed decisions, and the pinning worklist already use,
and every value set the plan reported", leaving coined terms to Unify.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F12 — Dependency waves need a consumes-graph the inputs do not supply

<details><summary><b>Description</b></summary>

`SKILL.md:49-51`:

> Dispatch in dependency waves: components that
>    consume nothing go first, and a composite waits until the sections it
>    quotes have drafted APIs.

The declared input is an order, not a graph (`SKILL.md:17-18`): "a component
inventory in implementation order" — and upstream defines that order by
complexity (`skills/web-ui-visual-decomposition/decomposition-format.md:54-57`):

> ## 7. Suggested implementation order
>
> Simplest to most complex; each step's output is consumed by later steps

No step derives or records which component consumes which, and no branch covers
an inventory where consumption is not stated or is mutually recursive. The
sibling implementation skill makes the derivation an explicit step ("Turn the
specification's component order into a dependency graph",
`skills/web-ui-spec-implementation/SKILL.md:69-70`); this skill assumes it.

**Fix:** have step 1 record the consumes-edges alongside the inventory, and name
the fallback when the plan does not state them (ask the user, or serialize the
dispatch in inventory order).
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F13 — The Final assembly section has no producer and a conflicting approval rule

<details><summary><b>Description</b></summary>

`specification-format.md:101-105`:

> ### Final assembly
>
> The closing section composes the earlier components into the feature. When
> the assembly is large, split it into staged slices — by entity or screen —
> each with its own approval.

No protocol step produces it. Step 4 dispatches "one component per dispatch"
for "every inventory item" (`SKILL.md:47-55`), and the brief's `COMPONENT` slot
admits only "kind (new / extension / reuse)" (`section-brief.md:9-10`), which
does not describe an assembly; whether the assembly is an inventory item, and
whether it follows the component-section shape (API, tokens, tests, showcase,
consumer adoption) or a different one, is left open. The slice rule also
collides with the Gate (`SKILL.md:63-64`): "Present the whole document for
section-by-section review" — one document-wide approval pass versus per-slice
approvals, with no statement of whether slice approval happens here or during
implementation (`SKILL.md:66-67`: "implementation begins outside this skill").

**Fix:** state whether the assembly is an inventory item drafted by its own
dispatch and which shape its brief carries, and place the slice approvals
explicitly in either the Gate or the implementation stage.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ 🟡 F14 — Step 2's exit criterion covers components step 1 exempted

<details><summary><b>Description</b></summary>

Step 1 allows an inventory item to skip pinning (`SKILL.md:30-31`):

> **Ready when:** the marked values form the pinning worklist, and every
>    inventory item appears on it or is recorded as already pinned.

Step 2 then gates on all of them (`SKILL.md:38-39`):

> **Ready when:** every state of every component maps to a reference
>    location and a pinned value, or carries an explicit no-reference flag.

Since the fleet dispatches only "one `web-ui-inspector` agent per component
that needs pinning" (`SKILL.md:33-34`), an already-pinned component's *reference
locations* have no stated source — yet every section must open with them
(`specification-format.md:75-77`): "Each opens with its **reference
locations**: the exact places in the live reference and captures to validate
each state against."

**Fix:** state that "recorded as already pinned" requires the plan to supply
both the value and the reference location per state; otherwise the component
joins the pinning worklist.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ ⚪ F15 — The 200-word report cap collides with verbatim API reuse

<details><summary><b>Description</b></summary>

`section-brief.md:44-47`:

> Under 200 words: the heading written, the API signature, terms coined, value
> sets introduced, the UNVERIFIED list, and any plan detail that proved wrong.

The orchestrator must pass that signature on verbatim — `section-brief.md:17`
("**DEPENDENCIES** — the drafted API of every component this one consumes") and
item 5 (line 36: "Quote a dependency's API as the DEPENDENCIES slot states
it") — while the guardrail discourages reading part files back
(`SKILL.md:73-74`): "read a section back only when Unify needs that one". A
wide typed API with enumerated value sets can exhaust the budget alone, and a
truncated signature propagates into dependent sections.

**Fix:** exempt the API block from the word budget, or permit reading a
dependency's part file when filling the DEPENDENCIES slot.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳ ⚪ F16 — Trigger vocabulary differs from the body's term

<details><summary><b>Description</b></summary>

`SKILL.md:3`:

> description: Compiles an approved plan into a specification ... Trigger when
> a plan or decomposition is approved and the specification that will govern
> the build does not exist yet.

"a plan or decomposition" reads as two admissible artifacts, while the body
knows exactly one — "Approved plan" (`SKILL.md:17`), "the approved plan"
(`SKILL.md:27`), "a plan decision" (`SKILL.md:76`) — and the document's own
rule is one term per concept (`specification-format.md:16-17`).

**Fix:** use one term in the trigger, e.g. "when an approved decomposition plan
exists", matching whatever the Inputs call it.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1.
</details>

### ⏳❓ F17 — Unverified: whether agents install alongside skills

<details><summary><b>Description</b></summary>

F3 rests on the `web-ui-inspector` agent being absent in some installs
(`SKILL.md:33-34`: "one `web-ui-inspector` agent per component that needs
pinning"). Whether an agent definition ships with a skill could not be settled
from the repository.

**Tried:** read `AGENTS.md` in full — it states only "Skills install one at a
time" (`AGENTS.md:9`) and describes `agents/` as part of the library
(`AGENTS.md:3-4`); searched `skills/` for install or packaging documentation —
none exists; confirmed `agents/web-ui-inspector.md` exists at HEAD, and that
`skills/web-ui-visual-decomposition/SKILL.md:31` hedges with "when installed",
which implies absence is possible but does not prove the coupling either way.

**Would settle it:** the install tooling or a packaging note stating whether
`agents/*.md` is delivered with a skill, or the sibling author's intent behind
"when installed".

**Fix either way:** the branch in F3 is cheap and harmless if agents do ship
with skills; the finding is about the missing "otherwise" path, not about the
agent being broken.
</details>

<details><summary><b>Status</b></summary>

⏳ Awaiting triage · ❓ Unverified · Severity 🟡 Medium
</details>

<details><summary><b>Updates</b></summary>

- 2026-09-18 10:37 — Raised in round 1 as unverified, with the attempts above
  recorded.
</details>

## Resolved and discarded

None yet — no finding has been triaged.
