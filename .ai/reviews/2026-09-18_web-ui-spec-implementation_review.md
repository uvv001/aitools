# Review — skills/web-ui-spec-implementation

Reviewed state, pinned:

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/web-ui-spec-implementation` → *(empty output — no uncommitted changes in the reviewed directory)*

Scope: instruction correctness and completeness of `skills/web-ui-spec-implementation/SKILL.md`,
`references/fleet-board.md`, `references/process-proposal.md`, `references/worker-brief.md`.
Read-only round: no skill file was modified. This report lives in git-ignored `.ai/reviews/`
(`.gitignore` line `/.ai/`) and is not committed.

Verified clean, so absent from the findings:

- All three reference links in `SKILL.md` (`references/process-proposal.md:35`,
  `references/fleet-board.md:77`, `references/worker-brief.md:82`) resolve to existing files,
  as does `[../SKILL.md](../SKILL.md)` in `worker-brief.md:6`. No other file paths are referenced.
- No sibling-skill **file path** is referenced anywhere in the directory (checked
  `web-ui-spec-authoring`, `web-ui-visual-decomposition`, `progress-tracking`, `agents/`).
  `SKILL.md:15` names `web-ui-spec-authoring` as a stage, not a path — that is concept-level and
  within the AGENTS.md rule. Borrowed *vocabulary* is a separate matter, see F16.
- The LOOP rungs duplicated in `worker-brief.md:17-20` match the loop in
  `web-ui-spec-authoring/references/specification-format.md:37-61` — the duplication the
  AGENTS.md self-sufficiency rule asks for is present and currently accurate (precedence gap: F18).
- `SKILL.md:64-68` ("Ready when" of Align) enumerates exactly the sections
  `process-proposal.md` carries (deployment, ladder, showcase surface, isolation level, seam
  validation, stage boundaries, board location).

## Dashboard

**Fix progress** — 0 findings 🔧 Fixed; 0 approved and awaiting a fix. No fixes requested this round.

**Triage state** — 23 findings total: 22 ⏳ Awaiting triage, 1 ❓ Unverified. 0 ✅ Approved,
0 ❌ Discarded, 0 📌 Deferred, 0 🔀 Improvement.

Severity spread: 🔴 5 · 🟡 13 · ⚪ 4 · (❓ F23 carries no severity until settled).

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: `SKILL.md:114-118`, `SKILL.md:158-159`, `worker-brief.md:24-26`<br>State: ⏳ Awaiting triage<br>No protocol step commits a worker's output, yet Integrate merges "the approved commits" and the board shows a commit per component. |
| F2 | Severity: 🔴 High<br>File: `SKILL.md:74-80`, `SKILL.md:88-89`, `SKILL.md:114`, `process-proposal.md:53-61`<br>State: ⏳ Awaiting triage<br>"The feature branch" is never established, and no instruction says what a worker's branch/worktree is created from — so a composite worker's bench need not contain its approved dependencies. |
| F3 | Severity: 🔴 High<br>File: `worker-brief.md:13-20`, `SKILL.md:133-134`, `SKILL.md:78-80`<br>State: ⏳ Awaiting triage<br>The LOOP's "adopt in the listed consumers" rung sends every worker into shared consumer files, breaking "exactly one owning agent per file"; nothing resolves the collision. |
| F4 | Severity: 🔴 High<br>File: `SKILL.md:152-157`, `SKILL.md:102-104`, `SKILL.md:112-113`, `worker-brief.md:45-46`<br>State: ⏳ Awaiting triage<br>At shared-checkout isolation, fleet rule 6 puts authoritative validation *after* the fleet while step 6 gates each component on worker-run evidence — the two orders contradict and no shared-checkout gate variant exists. |
| F5 | Severity: 🔴 High<br>File: `SKILL.md:107-113`, `SKILL.md:69-73`, `SKILL.md:119-125`<br>State: ⏳ Awaiting triage<br>A parked component has no defined outcome: step 6's "Ready when" (row shows ✅) is unreachable on the spec-defect path, and dependents plus the stage gate have no rule for a park that outlives the wave. |
| F6 | Severity: 🟡 Medium<br>File: `SKILL.md:107-111`, `SKILL.md:14-16`<br>State: ⏳ Awaiting triage<br>The spec-defect path says "carry the decision back into the specification" without naming who edits the approved specification, against "Implementation reports; it does not re-decide". |
| F7 | Severity: 🟡 Medium<br>File: `SKILL.md:104-106`, `fleet-board.md:34-40`, `fleet-board.md:47`<br>State: ⏳ Awaiting triage<br>The review→fix round has no board state and no named actor: "collect the defect list, fix, re-present" leaves the row at 🔍 while work is in flight. |
| F8 | Severity: 🟡 Medium<br>File: `worker-brief.md:38-39`, `worker-brief.md:45-46`, `SKILL.md:147-149`<br>State: ⏳ Awaiting triage<br>No outcome is defined for a rung the worker cannot get green: no retry budget, no re-dispatch rule, and "report complete only when every available method has run and passed" forbids reporting. |
| F9 | Severity: 🟡 Medium<br>File: `SKILL.md:60-63`, `fleet-board.md:35`<br>State: ⏳ Awaiting triage<br>Resume leaves 🚧 rows whose worker session is gone undefined; "reconcile the board against the repository" names no check and no outcome. |
| F10 | Severity: 🟡 Medium<br>File: `process-proposal.md:78-81`, `SKILL.md:64-68`<br>State: ⏳ Awaiting triage<br>Resume requires reading an approved proposal "from the record", but the template records only a presentation date — there is no field that makes approval checkable later. |
| F11 | Severity: 🟡 Medium<br>File: `SKILL.md:78-80`, `SKILL.md:133-134`<br>State: ⏳ Awaiting triage<br>The Isolate exit check compares only `planned` workers, so a new bench may collide with an in-flight (🚧) worker's files, port, or branch. |
| F12 | Severity: 🟡 Medium<br>File: `SKILL.md:94-101`, `SKILL.md:88-91`, `fleet-board.md:22-23`<br>State: ⏳ Awaiting triage<br>The "four moments" for board writes omit parking and the Demo/commit entry the board template requires, so mandated content has no write trigger. |
| F13 | Severity: 🟡 Medium<br>File: `fleet-board.md:22-23`, `worker-brief.md:24-26`, `worker-brief.md:52-54`, `SKILL.md:104`<br>State: ⏳ Awaiting triage<br>Nobody is told to keep the component served for the review round; the demo link is required "while the component is being served" but the worker's dispatch ends at its report. |
| F14 | Severity: 🟡 Medium<br>File: `worker-brief.md:17-23`, `worker-brief.md:36-39`, `process-proposal.md:31-37`, `fleet-board.md:47`<br>State: ⏳ Awaiting triage<br>"Rung" names two overlapping sets (LOOP rungs and ladder rungs) with no rule relating them, and the board example's "rungs 1–4" numbering has no source. |
| F15 | Severity: 🟡 Medium<br>File: `fleet-board.md:24-28`, `fleet-board.md:36-37`, `SKILL.md:108`, `SKILL.md:171-172`<br>State: ⏳ Awaiting triage<br>The approving human is "the user" in SKILL.md and "the developer" in fleet-board.md (and the worker is "the agent" once), against the skill's own "One name per concept". |
| F16 | Severity: 🟡 Medium<br>File: `worker-brief.md:29-30`, `SKILL.md:97-98`, `SKILL.md:182-184`<br>State: ⏳ Awaiting triage<br>"The vocabulary ledger" and "the session's progress record" are load-bearing but undefined inside this skill, which must stand alone per the AGENTS.md self-sufficiency rule. |
| F17 | Severity: 🟡 Medium<br>File: `fleet-board.md:48-49`, `fleet-board.md:20-21`, `fleet-board.md:53-55`, `SKILL.md:78-80`<br>State: ⏳ Awaiting triage<br>The example board contradicts its own Bench rule: a ⬜ row with no bench, a ⏸️ row with no branch, and a dependency (`badge`) that has no row. |
| F18 | Severity: 🟡 Medium<br>File: `worker-brief.md:17-20`<br>State: ⏳ Awaiting triage<br>The LOOP slot hard-codes seven rungs while calling them "the specification's per-component loop rungs"; no precedence rule says which wins when the specification's loop differs. |
| F19 | Severity: ⚪ Low<br>File: `SKILL.md:30`, `SKILL.md:94-96`, `SKILL.md:123-125`<br>State: ⏳ Awaiting triage<br>The protocol reads as a linear 0–8 list but is nested loops (per wave, per component, per stage); only one loop-back point is stated, and step 5 is a cross-cutting rule, not a step. |
| F20 | Severity: ⚪ Low<br>File: `process-proposal.md:3-6`, `process-proposal.md:74-76`, `worker-brief.md:11-12`, `worker-brief.md:27-28`<br>State: ⏳ Awaiting triage<br>The proposal is "the runbook every worker brief quotes" yet records neither the specification path nor the conventions file path the briefs require. |
| F21 | Severity: ⚪ Low<br>File: `SKILL.md:119-125`<br>State: ⏳ Awaiting triage<br>The stage-gate waiver ("or explicitly waived the stop") appears only in the exit criterion; the instruction body says stop unconditionally and never defines a waiver. |
| F22 | Severity: ⚪ Low<br>File: `process-proposal.md:31-37`<br>State: ⏳ Awaiting triage<br>The ladder template pre-fills "Gates (proposed)" for four rungs and leaves the e2e row blank, reading as an omission rather than a deliberate slot. |
| F23 | Severity: ❓ Unverified<br>File: `fleet-board.md:20-21`, `fleet-board.md:46`, `SKILL.md:99-101`<br>State: ❓ Unverified<br>The board mandates a "worker session id" per row; whether an orchestrating agent can obtain that identifier for a subagent is harness-dependent and unsettled by the text. |

## Findings

### ⏳ 🔴 F1 — Nothing in the protocol commits a worker's output, but Integrate merges commits

<details>
<summary>Description</summary>

Step 7 assumes commits exist:

```
114: 7. **Integrate.** Merge approved work into the feature branch per project
115:    convention, then re-validate the merged result at the seam, run by
116:    whoever the proposal names. At stage close, prepare the PR description.
117:    **Ready when:** the feature branch contains the approved commits and the
118:    seam run covered the rungs the proposal assigned it.
```
(`skills/web-ui-spec-implementation/SKILL.md:114-118`)

The worker is barred from creating them by default:

```
24: - **PERMISSIONS** — side effects, stated explicitly: commit/stage (default:
25:   the orchestrator owns git; the worker commits only when this slot says
26:   so), long-running servers on the assigned port.
```
(`references/worker-brief.md:24-26`)

And no protocol step (0–8) instructs the orchestrator to commit. Committing appears only as an
adjective inside a fleet rule:

```
158: 7. **Slice-wise consumption** *(orchestrator)* — fleet output is isolated,
159:    verified, committed, and reviewed one component at a time.
```
(`SKILL.md:158-159`)

Meanwhile the board demands a commit hash before approval — the example's 🔍 row carries
`commit `b3f41c2`` (`references/fleet-board.md:47`), per:

```
22: - **Demo** — the showcase URL as a clickable link, while the component is
23:   being served; plus the latest commit.
```
(`references/fleet-board.md:22-23`)

So the process is unexecutable as written at default permissions: an orchestrator that owns git is
never told when to commit, on which branch/worktree, or whether the commit precedes review (rule 7
orders "verified, committed, and reviewed") or follows approval (step 7's "approved commits").

Suggested fix: add the commit to a numbered step — either extend step 6 ("on report receipt, the
orchestrator commits the worker's bench to its branch before presenting") or make the
worker-brief PERMISSIONS default "the worker commits on its own branch" — and state the ordering
once so rule 7, the board's Demo line, and step 7 agree.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Verified by full-text search for "commit"
  across all four files: occurrences are `SKILL.md:117`, `SKILL.md:159`, `fleet-board.md:22-23`,
  `fleet-board.md:46-47`, `worker-brief.md:24-26` — none is an instruction to commit at a moment.
</details>

### ⏳ 🔴 F2 — The feature branch and the workers' branch base are never established

<details>
<summary>Description</summary>

Step 7 uses a definite article for a branch no earlier text creates or names:

```
114: 7. **Integrate.** Merge approved work into the feature branch per project
```
(`SKILL.md:114`)

Step 0's exit criterion lists everything the proposal must record and the integration target is not
among them (`SKILL.md:64-68`), and the proposal's isolation section records only names:

```
59:                                          Include the naming
60: convention for worktrees, branches, and ports (for example
61: `<feature>_<component>`).
```
(`references/process-proposal.md:59-61`)

The consequence is larger than a missing noun. Step 2 creates each bench:

```
74: 2. **Isolate.** Give each worker its bench per the approved level —
75:    worktree, branch, and port, or a named disjoint file scope — and record
```
(`SKILL.md:74-75`)

without saying what the branch is created *from*, and step 4 dispatches composites on approval
alone:

```
88: 4. **Dispatch in waves.** Leaves first; composites once their dependencies
89:    are approved. A worker blocked mid-flight — a dead live reference, a
```
(`SKILL.md:88-89`)

A composite's bench can therefore be cut from a base that lacks its approved dependencies, and the
worker will build against components that do not exist in its worktree — the exact failure the
dependency wave exists to prevent. The missing rule is that a wave's benches branch from the
integration branch *after* the previous wave's components were merged (step 7), which makes
integration a precondition of dispatch, not just an epilogue.

Suggested fix: add the integration branch to the proposal (its own slot, echoed in step 0's "Ready
when") and state in step 2 that a bench branches from the integration branch as it stands after the
last integration, so an approved-but-unintegrated dependency blocks dispatch.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Cross-checked: "feature" appears elsewhere only
  as the `<feature>` placeholder in bench names (`fleet-board.md:46-49`, `process-proposal.md:61`)
  and in "per-feature machine state" (`SKILL.md:182`); no text defines the branch or a base.
</details>

### ⏳ 🔴 F3 — Consumer adoption inside each worker's loop breaks one-owner-per-file

<details>
<summary>Description</summary>

Fleet rule 1 is absolute:

```
133: 1. **Bounded disjoint scopes** *(orchestrator)* — one unit of work per
134:    agent, and exactly one owning agent per file.
```
(`SKILL.md:133-134`)

and the brief's SCOPE repeats it:

```
13: - **SCOPE** — the files and directories this worker owns, disjoint from
14:   every other worker.
```
(`references/worker-brief.md:13-14`)

But the loop each worker runs ends inside files it does not own:

```
17: - **LOOP** — the specification's per-component loop rungs bound to this
18:   component: create and export, unit-test every listed state, show every
19:   state on the showcase surface, localize per convention, validate
20:   standalone, adopt in the listed consumers, review against conventions.
```
(`references/worker-brief.md:17-20`)

Two rungs collide with disjointness by construction: "show every state on the showcase surface"
(one shared showcase app/route registry) and "adopt in the listed consumers" (a screen that several
components replace structures in — the specification assigns adoption to each component's own
step). The skill never resolves this: no step serializes adoption, assigns the showcase/consumer
files to the orchestrator, or defers adoption to integration, and the Isolate check
(`SKILL.md:78-80`) simply asserts "no two `planned` workers share a file", which cannot hold while
the LOOP mandates shared-file edits.

Suggested fix: name the exception explicitly — e.g. showcase registration and consumer adoption are
performed by the worker only inside per-component files, with shared registries/screens edited by
the orchestrator at integration (step 7), or adoption serialized as a follow-up single-file
dispatch — and reconcile the Isolate exit check with whichever rule is chosen.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Confirmed the adoption rung is inherited by
  design, not a stray phrase: `web-ui-spec-authoring/SKILL.md` guardrail "Adoption belongs to the
  component's own section … adoption runs inside that component's step". The conflict is therefore
  real for any fleet run and must be settled here.
</details>

### ⏳ 🔴 F4 — Shared-checkout isolation contradicts per-component gating

<details>
<summary>Description</summary>

Fleet rule 6 defines a mode where per-component evidence is untrustworthy until the whole fleet
stops:

```
152: 6. **Shared checkouts validate post-fleet** *(orchestrator)* — broken
153:    intermediate builds are
154:    expected while a fleet runs against shared files; post-fleet diagnostics
155:    are the authoritative missed-work list. With per-worker isolation the
156:    worker's own ladder run is authoritative for its scope, and post-fleet
157:    diagnostics cover only the integration seam.
```
(`SKILL.md:152-157`)

Step 6 gates each component on exactly that untrustworthy evidence, with no shared-checkout
variant:

```
102: 6. **Gate per component.** A worker reports complete only after exhausting
103:    every validation rung its bench permits; validation is where visual
104:    defects die, not review.
…
112:    **Ready when:** the component's row shows ✅ and the presentation carried
113:    evidence from the highest rung available to that worker.
```
(`SKILL.md:102-104`, `SKILL.md:112-113`)

The brief carries the same tension internally: its "Done when" demands green rungs
(`worker-brief.md:45-46`, "every VALIDATION rung the bench permits has run green") while its own
guardrail hands authority elsewhere in the same mode:

```
64: - At per-worker isolation the worker's ladder run is authoritative for its
65:   scope; in a shared checkout the orchestrator's post-fleet diagnostics are.
```
(`references/worker-brief.md:64-66`)

An agent running the light isolation level has no defined answer to: what does a shared-checkout
bench "permit"? does the gate wait for the whole wave to finish before presenting the first
component? who runs the post-fleet diagnostics and at which step? Nothing in steps 4–7 schedules a
post-fleet diagnostic run at all.

Suggested fix: give step 6 an explicit shared-checkout branch — the wave completes, the orchestrator
(or the seam validator) runs the ladder once over the shared checkout, and components are then
presented one at a time with that run as their evidence — and add that run as a numbered action so
it has a place in the protocol.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Searched all four files for "post-fleet": only
  `SKILL.md:152,154,156` and `worker-brief.md:65` — no protocol step schedules the diagnostics run
  the rule makes authoritative.
</details>

### ⏳ 🔴 F5 — A parked component has no defined outcome for its dependents or the stage gate

<details>
<summary>Description</summary>

The spec-defect path parks the component:

```
107:    **A spec defect** — a section detail the build proves wrong — takes the
108:    other path: park the component, put the defect to the user as a design
109:    question, carry the decision back into the specification, and re-brief
110:    from the corrected section. That corrected section is the route back
111:    into the build.
112:    **Ready when:** the component's row shows ✅ and the presentation carried
113:    evidence from the highest rung available to that worker.
```
(`SKILL.md:107-113`)

The step's only exit criterion is unreachable on this branch — a parked row is ⏸️, never ✅
(`fleet-board.md:38`) — so an agent checking "Ready when" before moving on has no way to leave step
6 for a parked component, and the text gives no alternative exit ("or the row shows ⏸️ with the
design question posed").

Downstream, nothing defines what a long-lived park does to the rest of the effort:

```
69: 1. **Plan.** Turn the specification's component order into a dependency
70:    graph. A component is dispatchable when every component it consumes is
71:    approved.
```
(`SKILL.md:69-71`) — dependents of a parked component are permanently non-dispatchable, with no
instruction to re-plan, re-order, or escalate.

```
119: 8. **Stage gate.** At each boundary the proposal records, run the rungs it
120:    assigned to the stage close — the remote ones whose timeline cost was
121:    priced in Align — then present the stage and stop until the user
122:    continues.
123:    **Ready when:** every stage-close rung has run with its evidence
124:    attached, and the user approved the stage — or explicitly waived the
125:    stop — before the next stage's Plan begins.
```
(`SKILL.md:119-125`) — the stage gate has no rule for a stage that still contains ⏸️ or ⬜ rows: is
the boundary blocked, or does the stage close with the parked component carried forward?

Suggested fix: give step 6 a second exit criterion for the parked branch; state in step 1 or 4 what
happens to a parked component's dependents (parked-by-dependency, or re-planned around); and add to
step 8 whether a stage may close with open rows and, if so, how they are carried.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Checked `fleet-board.md` for a carry-forward
  rule: it states only "A dependency wave reads across stage boundaries, so the board outlives any
  single stage" (`fleet-board.md:4-5`), which describes the artifact's lifetime, not the gate's
  verdict on open rows.
</details>

### ⏳ 🟡 F6 — The spec-defect path never names who edits the specification

<details>
<summary>Description</summary>

```
107:    **A spec defect** — a section detail the build proves wrong — takes the
108:    other path: park the component, put the defect to the user as a design
109:    question, carry the decision back into the specification, and re-brief
110:    from the corrected section.
```
(`SKILL.md:107-110`)

"Carry the decision back into the specification" is an unassigned action, and it sits against the
skill's own boundary statement:

```
14: The specification is fixed: a detail that proves wrong stops the component
15: and returns to the design stage (`web-ui-spec-authoring`), which owns the
16: decision. Implementation reports; it does not re-decide.
```
(`SKILL.md:14-16`)

An agent cannot tell whether it should edit the approved specification document itself (which reads
as re-deciding, and would bypass the design stage's own approval gate), hand the decision back and
wait for the design stage to re-issue the section, or record the decision somewhere else. The
difference matters because the next instruction — "re-brief from the corrected section" — cannot
start until someone has produced that corrected section.

Suggested fix: name the actor and the artifact, e.g. "the user's decision is applied to the
specification by the design stage; implementation re-briefs only from a section the user has
re-approved", or explicitly permit the orchestrator to patch the section and mark it for design
review.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Cross-checked the design stage's side:
  `web-ui-spec-authoring/SKILL.md` guardrail "A defect that stage reports comes back here to be
  re-decided rather than improvised around" — i.e. the sibling expects the edit to happen there,
  which this text does not say.
</details>

### ⏳ 🟡 F7 — The review→fix round has no board state and no named actor

<details>
<summary>Description</summary>

```
104:    defects die, not review. Then present the component, collect the defect
105:    list, fix, re-present. Approval is explicit and per component; an edit to
106:    approved work sends it back to review.
```
(`SKILL.md:104-106`)

"Fix" has no actor. The guardrail "Hold the board, not the components" (`SKILL.md:163-166`) implies
a re-dispatch to a worker, but nothing says whether the original worker is re-dispatched with the
defect list, a fresh worker is briefed, or the orchestrator edits — and the brief is titled a
dispatch for *building* one component, with prior defect lists appearing only as pre-seeded KNOWN
FACTS (`worker-brief.md:29-30`).

The board has no state for it either. The states table covers dispatch, report, approval and park:

```
34: | ⬜ | planned | scoped, not yet dispatched |
35: | 🚧 | in progress | worker dispatched |
36: | 🔍 | awaiting review | worker reported complete; presented to the developer |
37: | ✅ | approved | explicitly approved by the developer |
38: | ⏸️ | parked | blocked mid-flight; the entry names the blocker and what clears it |
```
(`fleet-board.md:34-38`)

and the only transition rule is for post-approval edits: "An edit to approved work reverts the icon
to 🔍" (`fleet-board.md:40`). The example shows the gap: a component whose review returned defects
sits at 🔍 "awaiting review" although the review already happened and the fix is outstanding —

```
47: | **filter-tree** 🔍 | … <br>- 09-01 11:02 developer review 1: tree has border absent from mockup; hover overrides selected background
```
(`fleet-board.md:47`)

so the board cannot distinguish "waiting for the developer" from "fixing the developer's defects",
which is the state the orchestrator most needs when deciding what to do next.

Suggested fix: state who fixes (re-dispatch the same worker with the defect list as the brief's
KNOWN FACTS is the natural reading) and either add a state for the fix round or say explicitly that
the row returns to 🚧 until the fix is re-presented.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Re-read both files for a re-dispatch rule:
  fleet rule 4 covers only blocked work becoming "a wider-scope follow-up agent"
  (`SKILL.md:147-149`), not defect fixes.
</details>

### ⏳ 🟡 F8 — No outcome for a validation rung the worker cannot get green

<details>
<summary>Description</summary>

The worker's completion condition is unconditional success:

```
38: 3. Exhaust the VALIDATION rungs the BENCH permits. Report complete only
39:    when every available method has run and passed.
```
(`references/worker-brief.md:38-39`)

```
45: **Done when:** every VALIDATION rung the bench permits has run green, and
46: the report carries evidence from the highest rung reached.
```
(`references/worker-brief.md:45-46`)

The two escape hatches cover other cases: PARKED is for "a dead reference or unavailable
environment" (`worker-brief.md:62-63`), and escalation is for *blocked* work:

```
147: 4. **Escalate, don't improvise** *(worker raises, orchestrator
148:    re-dispatches)* — blocked single-scope work becomes a wider-scope
149:    follow-up agent, not a quiet scope expansion.
```
(`SKILL.md:147-149`)

A red rung inside the worker's own scope — a test it cannot make pass, a visual it cannot match — is
neither blocked nor parked, so the instructions say only "keep going": no attempt budget, no
"report NOT DONE with the failing rung", no orchestrator-side rule for receiving a failed report.
That is an open loop in the branch most likely to occur.

Suggested fix: add a third report status (e.g. FAILED/NOT DONE) with its trigger — a rung still red
after N attempts — and the orchestrator's response (re-dispatch with the diagnosis, escalate per
rule 4, or present as a spec defect when the failure traces to the section).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. The Report section lists "blockers"
  (`worker-brief.md:50-52`) but the contract forbids a complete report without green rungs, so the
  two do not combine into a defined failure status.
</details>

### ⏳ 🟡 F9 — Resume does not define how to handle in-flight (🚧) rows

<details>
<summary>Description</summary>

```
60:    **Resuming** — an effort that already has a board and an approved
61:    proposal is aligned: read both, reconcile the board against the
62:    repository, and continue at step 1 with the next wave. Re-open Align
63:    where the repository contradicts a fact the proposal records.
```
(`SKILL.md:60-63`)

Resumption is a headline trigger of this skill ("or when a paused implementation stage resumes",
`SKILL.md:3`), yet the most common resume state has no rule: a row at 🚧, "worker dispatched"
(`fleet-board.md:35`), whose worker session no longer exists because the previous session ended.
"Reconcile the board against the repository" names neither the checks (does the worktree exist? does
its branch hold commits? were the rungs run?) nor the outcomes (re-dispatch, mark parked, present as
is, or discard the bench). "Continue at step 1 with the next wave" implies orphaned rows are simply
skipped, which would silently abandon in-flight work.

Suggested fix: enumerate the reconciliation outcomes per state — 🚧 with no live session →
re-dispatch from the existing bench with its progress as KNOWN FACTS; ⏸️ → re-check the blocker; 🔍
→ re-present; ✅ not yet merged → integrate — and only then continue at step 1.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Checked `fleet-board.md` Rules
  (`fleet-board.md:51-60`) for a resume rule: none; the rules cover row creation, board/record
  separation, and wave readiness only.
</details>

### ⏳ 🟡 F10 — The proposal template has no field recording that approval happened

<details>
<summary>Description</summary>

Resume depends on reading approval out of the artifact:

```
64:    **Ready when:** an approved process proposal is in hand — freshly
65:    approved or read from the record — and it records the deployment facts,
```
(`SKILL.md:64-65`)

But the template's only approval slot is a presentation date:

```
78: ## Approval
79:
80: Presented on _date_. Approval is explicit; feedback sends the proposal back
81: through revision. Implementation starts only after approval.
```
(`references/process-proposal.md:78-81`)

A later session reading the file finds "Presented on 09-01" and cannot tell whether the user
approved, asked for revisions, or never answered — so the Align exit criterion is not checkable from
the record, and the strongest guard in the skill ("No worker dispatches before that approval
exists", `SKILL.md:36-37`) rests on an unrecorded fact.

Suggested fix: make the slot record the verdict, e.g. "Presented on _date_ · Approved on _date_ by
_who_ · revisions: _list_", and have step 0's "Ready when" point at that line.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Also checked whether the board could carry the
  approval instead: `fleet-board.md` records component states only, and its proposal link is a
  location reference (`process-proposal.md:74-76`).
</details>

### ⏳ 🟡 F11 — The Isolate check compares only `planned` workers, not in-flight ones

<details>
<summary>Description</summary>

```
78:    **Ready when:** no two `planned` workers share a file — nor a port or
79:    branch at worktree isolation — and every worker's bench is on the
80:    board.
```
(`SKILL.md:78-80`)

The check is scoped to rows at ⬜ ("planned — scoped, not yet dispatched", `fleet-board.md:34`). A
second wave is isolated while wave-one workers are still 🚧, so the literal check passes even when a
new bench takes a file, port, or branch already owned by a running worker — the precise collision
fleet rule 1 forbids:

```
133: 1. **Bounded disjoint scopes** *(orchestrator)* — one unit of work per
134:    agent, and exactly one owning agent per file.
```
(`SKILL.md:133-134`)

Because the exit criterion is the operative instruction at that step, an agent following it as
written can create a real conflict and still call the step ready.

Suggested fix: widen the check to every row that is not ✅ or ⏸️ — "no two workers with open rows
share a file, port, or branch" — so it matches rule 1.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Confirmed the board persists rows across waves
  and stages (`fleet-board.md:3-5`), so overlapping wave states are the normal case, not an edge
  case.
</details>

### ⏳ 🟡 F12 — The four board-write moments omit content the board template requires

<details>
<summary>Description</summary>

```
94: 5. **Track.** The board is written at four moments: a bench assigned (2),
95:    a worker dispatched (4), a gate outcome (6), and integration (7). Each
96:    lands the same turn its event happens, as theses linked to artifacts.
```
(`SKILL.md:94-96`)

Two board obligations fall outside those four:

1. **Parking.** Step 4 makes it a board event — "is parked with the reason named: parked is a board
   state, not a silent stall" (`SKILL.md:90-91`) — and the example carries a parked entry
   (`fleet-board.md:49`), but a mid-flight park is neither a dispatch nor a gate outcome, so the
   Track rule does not schedule its write.
2. **Demo.** The template requires a live link and a commit:

```
22: - **Demo** — the showcase URL as a clickable link, while the component is
23:   being served; plus the latest commit.
```
(`references/fleet-board.md:22-23`)

   A serving URL appears while the worker runs, not at any of the four moments.

The step's own exit criterion then under-checks: "no event from steps 2, 4, 6, or 7 is missing its
entry" (`SKILL.md:100-101`) cannot catch a missing park or demo entry.

Suggested fix: make it five moments (add "a park or unpark") and fold the Demo line into the
dispatch/report writes, then widen step 5's "Ready when" to match.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Considered whether "a gate outcome (6)" absorbs
  report receipt: `fleet-board.md:53-55` does say "a report's receipt lands as progress entries the
  same turn", so report receipt is covered; parking and Demo remain unscheduled.
</details>

### ⏳ 🟡 F13 — Nobody is told to keep the component served for the review round

<details>
<summary>Description</summary>

The board requires a live demo link at review time:

```
22: - **Demo** — the showcase URL as a clickable link, while the component is
23:   being served; plus the latest commit.
```
(`references/fleet-board.md:22-23`, illustrated by the 🔍 row at `fleet-board.md:47`)

Serving is a worker permission:

```
24: - **PERMISSIONS** — side effects, stated explicitly: commit/stage (default:
…
26:   so), long-running servers on the assigned port.
```
(`references/worker-brief.md:24-26`)

but the worker's dispatch ends with its report — "The work stays on the worker's bench — report the
index, not the content" (`worker-brief.md:52-54`) — and step 6 then presents the component to the
user without saying who serves it:

```
104:    defects die, not review. Then present the component, collect the defect
```
(`SKILL.md:104`)

So an agent cannot tell whether the worker must leave its server running after reporting (and who
stops it, and what frees the port for the next wave), or whether the orchestrator starts the
showcase from the worker's bench for the review. At shared-checkout isolation there is no assigned
port at all, and the Demo line has no stated substitute.

Suggested fix: state the serving owner and lifetime — e.g. "the worker leaves the showcase served on
its port until the component is approved; the orchestrator releases the port at integration" — and
say what the Demo cell holds when no port is assigned (screenshots plus the command to serve).
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Checked the proposal for a port-lifetime rule:
  its isolation section covers only the naming convention for "worktrees, branches, and ports"
  (`process-proposal.md:59-61`), and the janitor line covers "aborted runs"
  (`process-proposal.md:18-19`), not review-time serving.
</details>

### ⏳ 🟡 F14 — "Rung" names two different sets, and the board example numbers them

<details>
<summary>Description</summary>

The brief uses the word for the specification's build loop:

```
17: - **LOOP** — the specification's per-component loop rungs bound to this
18:   component: create and export, unit-test every listed state, show every
19:   state on the showcase surface, localize per convention, validate
20:   standalone, adopt in the listed consumers, review against conventions.
21: - **VALIDATION** — the rungs this worker must exhaust per the approved
22:   process proposal, capped by its bench; the showcase surface and the
23:   verification viewport.
```
(`references/worker-brief.md:17-23`)

and for the verification ladder:

```
31: | Rung | Available | How to run | Gates (proposed) |
…
33: | Unit tests | | | every component |
34: | Build | | | every component |
35: | Showcase / visual | | | every component |
36: | Consumer adoption re-verify | | | adopting components |
37: | Integration / acceptance / e2e | | | |
```
(`references/process-proposal.md:31-37`)

The two sets overlap (unit tests, showcase, consumer adoption appear in both) but are ordered and
owned differently, and the contract asks for both in consecutive lines — "Run the LOOP rungs in
order" then "Exhaust the VALIDATION rungs the BENCH permits"
(`worker-brief.md:36-39`) — with no statement of how they relate. A worker cannot tell whether
running the LOOP already satisfies the overlapping VALIDATION rungs or whether they are separate
runs, nor which set "the highest rung reached" (`worker-brief.md:45-46`) refers to.

The board example compounds it by numbering rungs that are numbered nowhere:

```
47: … - 09-01 10:40 worker: rungs 1–4 green; e2e n/a, no local backend |
```
(`fleet-board.md:47`)

The "1–4 … e2e" shape implies the ladder's five rows, but the ladder table is unnumbered and the
LOOP has seven items, so an agent transcribing a report cannot reproduce the notation.

Suggested fix: reserve "rung" for the verification ladder and call the specification's loop
"steps"; state that a LOOP step satisfying a ladder rung counts once; and either number the ladder
rows in `process-proposal.md` or drop the numeric shorthand from the example.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Verified no numbering exists: searched all four
  files for a numbered ladder; `SKILL.md:46-48` gives the ladder as an arrow chain, the proposal as
  an unnumbered table.
</details>

### ⏳ 🟡 F15 — Two names for the approving human, one for the worker

<details>
<summary>Description</summary>

`SKILL.md` calls the human "the user" throughout — "establish three project facts with the user"
(`SKILL.md:32-33`), "put the defect to the user as a design question" (`SKILL.md:108`), "the user
approved the stage" (`SKILL.md:124`). `fleet-board.md` calls the same actor "the developer":

```
36: | 🔍 | awaiting review | worker reported complete; presented to the developer |
37: | ✅ | approved | explicitly approved by the developer |
```
(`references/fleet-board.md:36-37`)

```
24: - **Progress** — dated theses, newest first, from both sides of the loop:
25:   the agent's milestones (states built, rungs run, with evidence — test
26:   output, screenshot, URL) and the developer's feedback (each review
```
(`references/fleet-board.md:24-26`)

The same passage also calls the worker "the agent", a third label beside "worker" and "subagent".
Since the board is the machine state an agent both writes and reads, a reader can plausibly infer a
separate human developer distinct from the requesting user (who approves what, then?). The skill
itself forbids exactly this:

```
171: - **One name per concept.** Workers use the specification's vocabulary; a
172:   coined synonym is a defect to unify, not a style choice.
```
(`SKILL.md:171-172`)

Suggested fix: use "the user" and "the worker" everywhere, including the board's states table,
Progress bullet, and example rows.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Counted usages: "developer" appears only in
  `fleet-board.md` (lines 26, 28, 36, 37, 46, 47); "the user" only in `SKILL.md` (33, 108, 121, 124)
  and `process-proposal.md` (5, 42).
</details>

### ⏳ 🟡 F16 — Borrowed terms are load-bearing but undefined inside this skill

<details>
<summary>Description</summary>

The brief requires the orchestrator to pre-seed something this skill never defines:

```
29: - **KNOWN FACTS** — pre-seeded research: pinned values, the vocabulary
30:   ledger's terms, dependency APIs, prior defect lists for this component.
```
(`references/worker-brief.md:29-30`)

"The vocabulary ledger" is a `web-ui-spec-authoring` artifact (its §2 ledger, "one term per
concept"); an agent holding only this skill and a specification document has no definition telling
it what to look for or what to do when the specification has no such ledger.

The same applies to the progress record, which the skill makes an obligation:

```
97:    The board is the machine state; the session's progress record stays the
98:    narrative and links it.
```
(`SKILL.md:97-98`)

```
182: - **The board and the progress record stay separate.** Board = per-feature
183:   machine state; the session's progress record = the narrative. The record
184:   links the board and logs dispatch and report receipt separately.
```
(`SKILL.md:182-184`)

What the progress record is, where it lives, and what happens when none exists are never stated —
the concept belongs to the `progress-tracking` skill, which may not be installed. The repository
rule anticipates exactly this case: "duplicate the few lines you need instead of linking"
(root `AGENTS.md`, Skill authoring).

Suggested fix: add one defining clause at each site — "the vocabulary ledger (the specification's
term-per-concept table, §2)" and "the session's progress record (the running narrative file for the
session; where absent, the board alone carries the state)".
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Confirmed no path-level link to either sibling
  exists (so the AGENTS.md rule is not broken literally); the gap is the missing duplicated
  definition the same rule prescribes.
</details>

### ⏳ 🟡 F17 — The example board contradicts the board's own Bench rule

<details>
<summary>Description</summary>

The rule ties row creation to bench assignment:

```
53: - A worker's row exists at ⬜ from the moment its bench is assigned, ahead
54:   of the dispatch; a report's receipt lands as progress entries the same
55:   turn.
```
(`references/fleet-board.md:53-55`)

and the Bench line is defined as four parts:

```
20: - **Bench** — worktree, branch, port, and worker session id on one line,
21:   so the work can be found, served, resumed, or its traces attached.
```
(`references/fleet-board.md:20-21`)

The example breaks both:

```
48: | **details-card** ⬜ | waits on icons, badge |
49: | **empty-state** ⏸️ | `worktrees/<feature>_empty-state` · port 4203 · session `a91f…`<br>…
```
(`references/fleet-board.md:48-49`)

`details-card` is a ⬜ row with no bench at all, which the rule says cannot exist yet and which fails
the Isolate exit check "every worker's bench is on the board" (`SKILL.md:78-80`); `empty-state` is a
worktree-isolated row missing its branch. The example also names a dependency (`badge`) that has no
row, against "a scan down column one reads the whole effort" (`fleet-board.md:16-17`).

Since agents copy examples more faithfully than rules, the example should be the rule's proof.

Suggested fix: either relax the rule ("a row exists at ⬜ as soon as the component is planned; its
Bench line appears when the bench is assigned") and align step 2's exit check to dispatch-time, or
fix the example rows — give `details-card` a bench, `empty-state` a branch, and add a `badge` row.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Checked the "each appearing once it becomes
  true" clause (`fleet-board.md:17-18`) as a possible reconciliation: it governs section order
  inside a row, while line 53 governs when the row itself appears, so the contradiction stands.
</details>

### ⏳ 🟡 F18 — The LOOP slot hard-codes rungs it attributes to the specification

<details>
<summary>Description</summary>

```
17: - **LOOP** — the specification's per-component loop rungs bound to this
18:   component: create and export, unit-test every listed state, show every
19:   state on the showcase surface, localize per convention, validate
20:   standalone, adopt in the listed consumers, review against conventions.
```
(`references/worker-brief.md:17-20`)

The colon presents seven fixed rungs as if they were read out of the specification, but the
specification owns that loop ("The specification's own per-component loop is the worker's loop",
`SKILL.md:10`). When a specification's §2 lists different, fewer, or extra rungs, the brief author
has no precedence rule: copy the specification's loop, or impose this list?

Suggested fix: mark the list as the default and state precedence — "the specification's §2 loop
verbatim; where it is silent, these rungs" — which also keeps the duplication honest as the sibling
skill evolves.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Compared the list against
  `web-ui-spec-authoring/references/specification-format.md:37-61`: the seven rungs match today
  (create/export, unit-test, demo, localize, validate standalone, adopt, review), so this is a
  drift/precedence risk rather than a present mismatch.
</details>

### ⏳ ⚪ F19 — The protocol is a numbered list but executes as nested loops

<details>
<summary>Description</summary>

```
30: ## Protocol
```
(`SKILL.md:30`) introduces steps 0–8 as a sequence, yet three of them are not sequential:

- Step 5 is a cross-cutting rule, not a step: "The board is written at four moments: a bench
  assigned (2), a worker dispatched (4), a gate outcome (6), and integration (7)"
  (`SKILL.md:94-95`) — it describes writes that happen inside steps 2, 4, 6 and 7, i.e. before
  step 5 is reached.
- Steps 2–4 repeat per wave, and steps 6–7 repeat per component, but no loop-back is stated.
- The only stated return is at the end: "before the next stage's Plan begins" (`SKILL.md:125`).

An agent that reads 0→8 once will isolate and brief a single wave, gate one component, integrate,
and arrive at the stage gate with later waves never dispatched.

Suggested fix: state the iteration explicitly — e.g. "steps 2–4 run per wave, 6–7 per component;
return to step 2 while the stage has unapproved components" — and move step 5 into a rules block or
relabel it as a standing obligation.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Checked step 1's wording for an implicit loop:
  "every member of the current wave has its dependencies approved" (`SKILL.md:72-73`) presumes
  repetition but never schedules it.
</details>

### ⏳ ⚪ F20 — The proposal records neither the specification path nor the conventions file path

<details>
<summary>Description</summary>

```
3: The Align-step artifact: the runbook every worker brief quotes. Fill each
4: section from codebase research — an answer cites the code, config, or CI
5: definition that proves it.
```
(`references/process-proposal.md:3-5`)

Every brief needs two paths the runbook does not carry:

```
11: - **COMPONENT** — name, and its section in the approved specification (path
12:   plus heading).
…
27: - **CONVENTIONS FILE** — path only; the worker reads it. Project conventions
28:   outrank worker habits.
```
(`references/worker-brief.md:11-12`, `:27-28`)

The proposal's last location slot covers only the board: "Where the fleet board for this effort
lives" (`process-proposal.md:74-76`). On resume, an orchestrator rehydrating from proposal + board
(`SKILL.md:60-62`) has no recorded pointer to the specification or the conventions file and must
re-ask or re-discover them.

Suggested fix: extend the "Board location" section into an "Artifacts" section recording the
specification path, the conventions file path, and the board location.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Confirmed both artifacts are Inputs
  (`SKILL.md:22-26`) but neither is echoed into any persisted template.
</details>

### ⏳ ⚪ F21 — The stage-gate waiver exists only in the exit criterion

<details>
<summary>Description</summary>

```
119: 8. **Stage gate.** At each boundary the proposal records, run the rungs it
120:    assigned to the stage close — the remote ones whose timeline cost was
121:    priced in Align — then present the stage and stop until the user
122:    continues.
123:    **Ready when:** every stage-close rung has run with its evidence
124:    attached, and the user approved the stage — or explicitly waived the
125:    stop — before the next stage's Plan begins.
```
(`SKILL.md:119-125`)

The instruction says stop unconditionally; the exit criterion introduces a waiver that no
instruction establishes, defines, or records. An agent cannot tell what counts as an explicit waiver
(a standing instruction at Align? a one-off "keep going"?) or where it is logged, which makes the
one hard stop in the protocol softer than intended.

Suggested fix: define the waiver where it can be granted — e.g. "the user may waive the stop for a
named boundary; record the waiver in the proposal's stage-boundaries section" — or delete the clause.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Searched for "waive"/"waiver" in all four
  files: `SKILL.md:124` only.
</details>

### ⏳ ⚪ F22 — The ladder template leaves one Gates cell blank while pre-filling the rest

<details>
<summary>Description</summary>

```
31: | Rung | Available | How to run | Gates (proposed) |
32: |---|---|---|---|
33: | Unit tests | | | every component |
34: | Build | | | every component |
35: | Showcase / visual | | | every component |
36: | Consumer adoption re-verify | | | adopting components |
37: | Integration / acceptance / e2e | | | |
```
(`references/process-proposal.md:31-37`)

Four rows carry a proposed gate; the e2e row carries none. Because the column's other cells read as
template defaults, the blank reads as an omission rather than a deliberate slot — and the e2e gate
is precisely the one Align tells the agent to price and place: "local rungs gate each component,
remote e2e gates the stage close" (`SKILL.md:50-51`).

Suggested fix: pre-fill the cell with the default the skill already states (`stage close`) or mark
it explicitly, e.g. `_decide: per component or stage close_`.
</details>

<details>
<summary>Status</summary>

⏳ Awaiting triage · Severity ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0`. Noted the prose below the table does say the
  proposed column is "a starting position" (`process-proposal.md:41-42`), which argues for filling
  the cell rather than leaving it blank.
</details>

### ❓ F23 — "Worker session id" may not be obtainable by the orchestrator

<details>
<summary>Description</summary>

The board mandates a session identifier in every bench line, and an exit criterion checks it:

```
20: - **Bench** — worktree, branch, port, and worker session id on one line,
21:   so the work can be found, served, resumed, or its traces attached.
```
(`references/fleet-board.md:20-21`, example: ``session `680994b6…` `` at `fleet-board.md:46`)

```
99:    **Ready when:** the board answers, for every component — state, where the
100:    work lives, which session ran it — and no event from steps 2, 4, 6, or 7
101:    is missing its entry.
```
(`SKILL.md:99-101`)

What is unsettled: whether an orchestrating agent can read an identifier for a subagent it
dispatched, and which identifier is meant — the subagent's own session/agent id, or the
orchestrator's session id at the time of dispatch. Nothing in the skill says how to obtain it or
what to write when the harness exposes none (the brief's slots, `worker-brief.md:9-30`, do not ask
the worker to report one, and the Report section, `:48-54`, does not list it).

Tried: read all four files for any acquisition instruction (none); checked whether the Report could
supply it (it does not); checked the sibling `web-ui-spec-authoring` fleet steps for a precedent
(they persist inspector reports to a working folder, no session id). Settling it needs a decision
from the author on which identifier is meant plus, if it is the subagent's, one line on how the
orchestrator gets it and the fallback when it cannot ("worktree path substitutes").
</details>

<details>
<summary>Status</summary>

❓ Unverified — evidence attempted and unsettled; the user's call. Severity pending (🟡 if the id is
unobtainable in practice, ⚪ if it is trivially available).
</details>

<details>
<summary>Updates</summary>

- 2026-09-18 — Raised in round 1 against `8c1e8e0` as unverified; see Description for what was tried
  and what would settle it.
</details>


## Resolved and discarded

*(empty — no finding has been fixed or discarded in this round)*
