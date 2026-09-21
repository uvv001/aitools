# Review — `skills/cheatsheet`

**Reviewed state (pinned)**

- `git -C C:\dev\AI\own rev-parse HEAD` → `8c1e8e043e43357fbb270d5a9fefe78269f11ee2`
- `git -C C:\dev\AI\own status --porcelain -- skills/cheatsheet` → *(empty output — the
  skill directory is clean at the reviewed commit)*
- Files reviewed: `skills/cheatsheet/SKILL.md` (88 lines, the only file in the
  directory).

**Scope** — correctness and completeness of the *instructions*: followability,
decision-tree completeness, internal consistency, and existence of referenced
paths/commands. Prose style and code formatting are out of scope except where
they change what an agent would do.

**Adaptations to `skills/review-with-docs/report-format.md`** — the report lives
in `.ai/reviews/` (git-ignored) instead of `docs/`, is not committed, and every
finding starts in state ⏳ Awaiting triage. Findings that carry an unsettled
element are marked `⏳❓` and name what was tried and what would settle them.

**Repository-rule compliance** — `AGENTS.md` requires each skill to reference
only files inside its own directory. `SKILL.md` references no sibling-skill file
and no file outside its own directory (verified by reading every line; the only
paths it names are workspace artifacts `.ai/cheatsheet.md` and user-supplied
vault paths). **No violation of the self-sufficiency rule.**

**Verification performed**

- Rendered `SKILL.md` lines 62–77 through the `marked` lexer to confirm the
  nested-fence behaviour reported in F2.
- Parsed the Mermaid block (lines 15–26) with `mermaid@11` + `jsdom`:
  `PARSE OK: {"diagramType":"flowchart-v2"}` — the diagram is syntactically
  valid, so no finding is raised against its syntax (only against its missing
  branch, F13).
- `git grep -in "run_command"` and `git grep -in "obsidian"` across the
  repository to confirm referenced names (F3) and that no in-repo file is
  expected to exist for `obsidian_cheatsheet.md` (the skill correctly declares
  it out-of-repo).
- `git log --name-only -- skills/cheatsheet` → the directory has only ever
  contained `SKILL.md`; no deleted companion file is silently referenced.

## Dashboard

**Fix progress** — 0 🔧 fixed / 0 approved and awaiting a fix (nothing triaged yet).

**Triage state** — 18 findings: ⏳ 18 awaiting triage · ✅ 0 · 🔧 0 · ❌ 0 · 📌 0 · 🔀 0.
Two of the awaiting findings (F3, F10) carry an unverified element and are
marked `⏳❓`.

Severity spread: 🔴 1 · 🟡 10 · ⚪ 7.

## Summary table

| ID | Description |
|---|---|
| F1 | Severity: 🔴 High<br>File: `skills/cheatsheet/SKILL.md:51,53`<br>State: ⏳ Awaiting triage<br>"Elevate Legacy Entries" orders a rewrite of pre-existing vault content that rule 3 on the previous line forbids, with no scope limit and no user-confirmation branch. |
| F2 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:62-77`<br>State: ⏳ Awaiting triage<br>The canonical-layout example is a triple-backtick block containing triple-backtick blocks, so the template terminates at line 70 and lines 72–77 escape the example. |
| F3 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:33`<br>State: ⏳❓ Awaiting triage (unverified element)<br>Step 1 names a tool `run_command` that is defined nowhere in the skill or repository, and gives no fallback when session history is unavailable. |
| F4 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:31-34`<br>State: ⏳ Awaiting triage<br>No defined outcome when the session yielded no qualifying commands, although the trigger admits such requests and invariant 4 forbids inventing them. |
| F5 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:35`<br>State: ⏳ Awaiting triage<br>Storage rule is under-specified: "e.g." undercuts the canonical filename, "project root" has no fallback outside a project, and a pre-existing cheatsheet has no overwrite/append/rename rule. |
| F6 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:36-38`<br>State: ⏳ Awaiting triage<br>The git-exclusion rule is a prohibition with no verification step: nothing checks the ignore rule or the file's tracked state. |
| F7 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:47-52`<br>State: ⏳ Awaiting triage<br>Stage 2 has no failure branches: missing/unreadable target, target outside reachable storage, or no Stage-1 cheatsheet in this session. |
| F8 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:52`<br>State: ⏳ Awaiting triage<br>Step 4 tests for a *command* but acts on a *tool section*, and leaves "tool section absent" and "identical use case already present" undefined. |
| F9 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:33-34,88`<br>State: ⏳ Awaiting triage<br>Real session commands are copied verbatim into a file and into the user's vault with no redaction or placeholder rule for secrets, hosts, and private paths. |
| F10 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:33-34,88`<br>State: ⏳❓ Awaiting triage (unverified element)<br>Extraction admits failed and later-corrected invocations; curation filters only duplicates, so a cheatsheet of commands that did not work satisfies every stated rule. |
| F11 | Severity: 🟡 Medium<br>File: `skills/cheatsheet/SKILL.md:88`<br>State: ⏳ Awaiting triage<br>Invariant 4's scope over Stage 2 is undefined: read strictly it forbids the legacy elevation that step 5 mandates. |
| F12 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:85-86`<br>State: ⏳ Awaiting triage<br>No threshold separates "simple commands" from "dense flag clusters", and the canonical template never shows the bulleted-breakdown form the rule requires. |
| F13 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:19-23`<br>State: ⏳ Awaiting triage<br>The flowchart has no edge for "user does not approve", and omits the curation and canonical-structure steps the prose requires. |
| F14 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:40,54`<br>State: ⏳ Awaiting triage<br>Neither stage has a checkable exit criterion: "Present", "request review", and "Verify the file update" are undefined operations, and non-interactive runs have no path. |
| F15 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:29,38`<br>State: ⏳ Awaiting triage<br>The artifact is called ephemeral and temporary but nothing defines its disposal or retention after either exit. |
| F16 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:63,87`<br>State: ⏳ Awaiting triage<br>The standalone file's document-level structure (title/H1, frontmatter) is undefined, and no rule says which of the three language identifiers to use. |
| F17 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:50`<br>State: ⏳ Awaiting triage<br>Vault "metadata headers" are exemplified only as markdown headings, omitting Obsidian YAML properties, tags, and wikilinks that a merge can corrupt. |
| F18 | Severity: ⚪ Low<br>File: `skills/cheatsheet/SKILL.md:35`<br>State: ⏳ Awaiting triage<br>`.ai/cheatsheet.md` conflicts with the `_progress.md` naming rule another skill imposes on `.ai` artifacts; the shared folder convention is unstated here. |

## Findings

### ⏳ 🔴 F1 — "Elevate Legacy Entries" contradicts "Preserve All Vault Context"

<details>
<summary>Description</summary>

Two consecutive Stage 2 rules give opposite orders about the same bytes.

`skills/cheatsheet/SKILL.md:51`

```
3. **Preserve All Vault Context**: Never delete, truncate, or overwrite unrelated sections, personal notes, or metadata.
```

`skills/cheatsheet/SKILL.md:53`

```
5. **Elevate Legacy Entries**: If older entries in the target note lack flag explanations or distinct use-case headers, bring them up to the canonical standard during the merge.
```

and the diagram promises only `skills/cheatsheet/SKILL.md:25`

```
    S2A --> S2B[Non-destructive merge preserving vault metadata]
```

Rule 5's subject, "older entries in the target note", is unbounded: it reads as
every pre-existing entry, including tools this session never touched — exactly
the "unrelated sections" rule 3 protects. "Bring them up to the canonical
standard" means restructuring headings and rewriting descriptions, i.e.
overwriting. The agent is left to guess which rule wins, on the user's personal
vault, where the wrong guess is destructive and not recoverable through git
(the vault is declared out-of-repo at line 45).

Missing branch: there is no "ask before rewriting" or "leave as-is and report"
outcome.

Suggested fix: scope rule 5 to the tool sections this merge touches, state
explicitly that rule 3 wins for everything else, and add a branch that reports
elevation candidates outside that scope to the user instead of rewriting them.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🔴 High
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Verified by re-reading lines 44–54
  in full: no scope limiter, precedence statement, or confirmation step exists
  anywhere between the Vault Boundary Rule and the end of Stage 2.
</details>

### ⏳ 🟡 F2 — Canonical-layout template nests same-length code fences and breaks

<details>
<summary>Description</summary>

The one normative example of the required output opens with a triple-backtick
`markdown` fence and then contains triple-backtick `shell` fences.

`skills/cheatsheet/SKILL.md:62-77`

````
```markdown
## <tool_name>
...
```shell
<command line invocation>
```

### <Action-Oriented Use Case 2 Title>
...
```shell
<command line invocation>
```
```
````

Verified by lexing lines 62–77 with `marked`:

```
code | markdown | "```markdown\n## <tool_name>\n<Short 1-2 sentence description o"
space |  | "\n\n"
heading |  | "### <Action-Oriented Use Case 2 Title>\n"
paragraph |  | "<Clear description of what the use case achieves, including "
code | shell | "```shell\n<command line invocation>\n```\n"
code |  | "```"
```

So the template ends at line 70; the second use case (lines 72–76) is parsed as
live document content — a real `###` heading inside the skill's own outline —
and line 77 opens an unterminated code block. Anyone reading the rendered skill
sees a truncated template, and an agent that mirrors the pattern reproduces the
same broken nesting in its output.

Suggested fix: open and close the template with a four-backtick fence so the
inner triple-backtick blocks are contained.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Confirmed empirically with the
  `marked` lexer rather than by inspection alone; token stream quoted above.
</details>

### ⏳❓ 🟡 F3 — `run_command` is an undefined tool reference with no fallback

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:33`

```
1. **Transcript Extraction**: Inspect session logs and tool calls (`run_command`) to extract all commands executed in the current session.
```

Two problems. First, `run_command` is named as if it were a known tool, but it
is defined nowhere in the skill and appears nowhere else in the repository
(`git grep -in "run_command"` returns only this line). Agents whose shell tool
is called something else (`bash`, `powershell`, `run_in_terminal`, …) are told
to inspect an artifact that does not exist for them. Second, "Inspect session
logs" implies a log store the skill never locates; on a resumed or
context-compacted session the transcript may simply be unavailable, and no
fallback is defined.

Suggested fix: describe the source harness-neutrally ("the shell commands
executed in this session, whatever the harness names its shell tool") and add a
fallback branch for an unavailable transcript (ask the user which commands to
document, or restrict to commands re-verified in the current session).

Unverified element (❓): whether `run_command` is the correct tool name in some
other harness the author targets cannot be settled from this repository. Tried:
full-repo `git grep`, reading every other skill and `agents/web-ui-inspector.md`
for tool-naming conventions — no other skill names a shell tool at all. What
would settle it: the author stating which harness(es) this skill installs into.
</details>

<details>
<summary>Status</summary>

State: ⏳❓ Awaiting triage (unverified element) · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1 with the grep evidence above.
</details>

### ⏳ 🟡 F4 — No branch when the session contains no qualifying commands

<details>
<summary>Description</summary>

The trigger admits requests that carry no session history,
`skills/cheatsheet/SKILL.md:5`

```
  Use when the user requests a command cheatsheet, asks to document terminal tools, or wants to merge session findings into reference notes.
```

while Stage 1 assumes there is something to extract,
`skills/cheatsheet/SKILL.md:31-33`

```
When the user asks to compile a cheatsheet or document commands used in the session:

1. **Transcript Extraction**: Inspect session logs and tool calls (`run_command`) to extract all commands executed in the current session.
```

and the invariant forbids filling the gap from knowledge,
`skills/cheatsheet/SKILL.md:88`

```
4. **Real-World Provenance**: Only include commands that were actually tested or executed in the session.
```

If the session executed no commands (a user asking to "document terminal tools"
at the start of a session), every downstream step still fires: the agent must
create `.ai/cheatsheet.md`, present it, and stop — with nothing in it. The
flowchart has the same gap: `S1B --> S1C` (lines 16–17) has no empty-result
edge. Outcome undefined: write an empty file, refuse, run the commands first,
or ask.

Suggested fix: add an explicit branch — when extraction yields nothing, say so
and offer to execute and verify commands first, rather than producing an empty
or invented cheatsheet.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ 🟡 F5 — Storage rule under-specified: filename, root, and collision

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:35`

```
3. **Storage Location (`.ai/cheatsheet.md`)**: Always save the draft cheatsheet inside the `.ai/` directory at the project root (e.g., `.ai/cheatsheet.md`). Create `.ai/` if it does not exist.
```

Three gaps in one rule:

1. **Name.** The heading, step 4, step 6, and Stage 2 step 4 all treat
   `.ai/cheatsheet.md` as a definite, known file, but this step demotes it to an
   example with "(e.g., …)". An agent cannot tell whether the name is fixed or
   free — and Stage 2 later reads "a command from `.ai/cheatsheet.md`" (line 52)
   as if the name were fixed.
2. **Root.** "the project root" is undefined when the session is not in a
   project or repository — a common case for a terminal-tool cheatsheet. No
   fallback (current directory, user-chosen workspace) is given.
3. **Collision.** Nothing says what to do when `.ai/cheatsheet.md` already
   exists from an earlier session, even though line 38 asserts "every session
   generates its own distinct commands" and the skill's own description (line 4)
   claims to cover "updating" cheatsheets. Overwrite, append, merge, or new name
   are all consistent with the text.

Suggested fix: pin one naming rule (fixed name, or a documented pattern), define
the fallback root, and define the pre-existing-file branch (append under existing
tool sections vs. new dated file).
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Cross-checked lines 17, 29, 38, 40,
  52: four sites treat the path as definite, only line 35 as exemplary.
</details>

### ⏳ 🟡 F6 — Git-exclusion rule has no verification step

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:36-38`

```
4. **Git Exclusion (Strict Rule)**:
   > [!CAUTION]
   > **Do NOT commit `.ai/cheatsheet.md` to git.** This artifact is temporary by nature because every session generates its own distinct commands. Even if `.ai/` is not listed in `.gitignore`, **never** stage or commit `.ai/cheatsheet.md` or any ephemeral cheatsheet file to version control.
```

The rule constrains only the agent's own `git commit`. It explicitly
contemplates the case where `.ai/` is not ignored, yet gives no action for it:
no instruction to add an ignore rule, no check that the file is untracked, and
no check after the file is written. In a repository where `.ai/` is not ignored,
a later blanket `git add -A` — by the same agent in a subsequent step, by a
different tool, or by the user — sweeps the artifact in, and every stated rule
was still followed.

Suggested fix: add a positive step — after creating the file, confirm the path
is ignored (e.g. `git check-ignore` on the file) and untracked; if it is not,
add the ignore rule or report the exposure before continuing.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ 🟡 F7 — Stage 2 has no failure branches for the target note

<details>
<summary>Description</summary>

Stage 2 assumes a readable target and a fresh Stage-1 artifact.

`skills/cheatsheet/SKILL.md:49-50`

```
1. **User-Provided Target**: Wait for the user to state which file to update (e.g., via `@[obsidian_cheatsheet.md]` or an absolute path like `~/vaults/tech/cheatsheet.md`).
2. **Audit Target Content First**: Read the target vault file completely. Inspect its existing structure, metadata headers (e.g., `# Meta`, `## Resources`), custom tags, and formatting style.
```

`skills/cheatsheet/SKILL.md:52`

```
4. **Enrich Existing Tool Sections**: If a command from `.ai/cheatsheet.md` already exists in the target note, append the new distinct use cases under that tool's section rather than creating duplicate headers.
```

Undefined branches:

- **Target does not exist / is unreadable / is outside reachable storage.** Step
  2 cannot be executed, and line 45 forbids searching for it: "Never assume a
  vault file exists in the Git repository or attempt to locate it
  automatically." Whether to create a new note at the given path, ask again, or
  abort is not stated.
- **Target exists but is empty or has no tool sections.** Step 4 covers only the
  "already exists" case (see F8).
- **No Stage-1 cheatsheet in this session.** The description (line 5) triggers
  the skill on "wants to merge session findings into reference notes", which can
  arrive without Stage 1, but line 47 requires only a merge request and a target,
  and step 4 then reads from a file that may not exist.

Suggested fix: define each branch — create-new-note (with the canonical
skeleton) on user confirmation, abort with a report on unreadable paths, and
require Stage 1 (or an explicit user-supplied source) before Stage 2.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Confirmed that `obsidian_cheatsheet.md`
  is correctly declared out-of-repo (line 45) and is absent from the repository,
  so the example path is not a broken in-repo reference.
</details>

### ⏳ 🟡 F8 — Merge rule tests a command but acts on a section; two branches missing

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:52`

```
4. **Enrich Existing Tool Sections**: If a command from `.ai/cheatsheet.md` already exists in the target note, append the new distinct use cases under that tool's section rather than creating duplicate headers.
```

The condition is about a *command* ("a command … already exists"), the action is
about a *tool section* ("under that tool's section"). The mapping between them is
never stated, and the two complementary branches are absent:

- **Tool section absent.** The obvious action — create a new `## <tool>` section
  — is nowhere written, and neither is where to place it (alphabetically, at the
  end, grouped) to keep the outline stable.
- **Use case already present.** When the note already contains the same command
  *and* the same use case, "append the new distinct use cases" gives no outcome:
  skip, replace with the better-explained version, or merge the descriptions.
  "distinct" itself is undefined — same binary with different flags, same flags
  with different targets, and same command with a better description all read as
  candidates.

Suggested fix: restate the rule as a two-branch decision on the *tool section*
(exists → append only use cases not already represented; absent → create the
section per the canonical layout at a stated position), and define "distinct".
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ 🟡 F9 — No redaction rule before session commands reach disk and the vault

<details>
<summary>Description</summary>

The skill takes real invocations verbatim and writes them into a file and then
into the user's personal vault.

`skills/cheatsheet/SKILL.md:33-34`

```
1. **Transcript Extraction**: Inspect session logs and tool calls (`run_command`) to extract all commands executed in the current session.
2. **Deduplication & Curation**: Filter out redundant duplicate commands. Group commands by utility and isolate real-world, high-value use cases.
```

`skills/cheatsheet/SKILL.md:88`

```
4. **Real-World Provenance**: Only include commands that were actually tested or executed in the session.
```

Curation filters duplicates and groups by utility; nothing filters content. Real
sessions contain API tokens and passwords on command lines, private hostnames
and IPs, and absolute user paths. The invariant pushes the other way — keep the
command as executed — and Stage 2 then propagates it into a long-lived note.

Suggested fix: add a curation sub-rule requiring secrets and environment-specific
values to be replaced with angle-bracket placeholders (`<token>`, `<interface>`,
`<host_ip>`) while keeping the invocation shape, and state that placeholder
substitution does not violate the provenance invariant.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Re-read lines 29–40 and 79–88: no
  sanitization, redaction, or placeholder instruction exists anywhere in the file.
</details>

### ⏳❓ 🟡 F10 — Failed and superseded invocations are not excluded

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:33`

```
1. **Transcript Extraction**: Inspect session logs and tool calls (`run_command`) to extract all commands executed in the current session.
```

`skills/cheatsheet/SKILL.md:88`

```
4. **Real-World Provenance**: Only include commands that were actually tested or executed in the session.
```

"all commands executed" and "actually tested or executed" both admit invocations
that errored, were rejected by the shell, or were corrected two attempts later.
The only filter is line 34's "Filter out redundant duplicate commands" plus
"isolate real-world, high-value use cases", which speaks to redundancy and value,
not to correctness. A cheatsheet consisting of the failed attempts satisfies
every stated rule — and a cheatsheet is precisely the artifact a user will later
copy without re-testing.

Suggested fix: require the recorded form to be the invocation that succeeded (or
the final corrected form), and state the exception — a failure kept deliberately
must be labelled as such.

Unverified element (❓): whether "isolate real-world, high-value use cases" was
intended to carry the success requirement implicitly cannot be settled from the
text. Tried: reading the full Stage 1 list and the four invariants for any
success/exit-code criterion — none appears. What would settle it: the author
confirming the intent.
</details>

<details>
<summary>Status</summary>

State: ⏳❓ Awaiting triage (unverified element) · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ 🟡 F11 — Invariant 4's scope over the vault merge is undefined

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:88`

```
4. **Real-World Provenance**: Only include commands that were actually tested or executed in the session.
```

The invariants sit under "Canonical Layout & Formatting Rules" (line 58), which
Stage 1 step 5 and Stage 2 step 5 both invoke as "the canonical standard".
Applied to Stage 2, invariant 4 forbids writing about any command not executed in
*this* session — which is exactly what
`skills/cheatsheet/SKILL.md:53` requires:

```
5. **Elevate Legacy Entries**: If older entries in the target note lack flag explanations or distinct use-case headers, bring them up to the canonical standard during the merge.
```

Legacy entries are, by definition, commands from earlier sessions; adding the
missing flag explanations means documenting commands this session never ran. An
agent applying the invariants uniformly must either refuse the elevation or
break the invariant, and the text does not say which.

Suggested fix: scope invariant 4 explicitly to Stage 1 compilation, and state
what governs legacy content during a merge (e.g. restructure headings and keep
existing prose; add flag explanations only where they can be sourced from the
tool's own documentation and marked as unverified).
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: 🟡 Medium
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Related to F1 but distinct: F1 is
  the preservation conflict, this is the provenance conflict; a fix must settle
  both.
</details>

### ⏳ ⚪ F12 — "Simple" vs "dense" flag threshold undefined and unillustrated

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:85-86`

```
   - Weave flag explanations into the paragraph for simple commands (`using single-attempt mode (-1) and numeric output (-n)`).
   - For dense flag clusters (e.g. `ss -tulpn` or `lsof -i -P -n`), include a bulleted breakdown of every flag.
```

The two examples given — `rdisc6 -1 -n` (two flags, woven) and `lsof -i -P -n`
(three flags, bulleted) — sit one flag apart, so the examples do not establish
the boundary they are meant to illustrate. Additionally, the canonical layout
template (lines 62–77) shows only the paragraph form, so the required output
shape for the bulleted variant is never shown.

Suggested fix: give a mechanical threshold (e.g. three or more flags, or any
bundled short-option cluster) and add the bulleted variant to the template.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ ⚪ F13 — Flowchart lacks the not-approved edge and two required steps

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:19-23`

```
    S1D --> S1E[Present to User for Review]
    
    S1E -->|User reviews & approves| Opt{User requests Obsidian merge?}
    Opt -->|No| Done[Workflow Complete]
    Opt -->|Yes - User specifies target location| S2[Stage 2: User-Directed Vault Merge]
```

`S1E` has exactly one outgoing edge, conditioned on approval; the review step
that can obviously fail has no failure edge back to compilation. The prose has
the same shape — line 40 ends at "**Stop here.**" — so the revision loop exists
nowhere.

The diagram also omits two steps the prose makes mandatory: deduplication and
curation (line 34) and applying the canonical structure (line 39), so the diagram
and the numbered list describe different processes.

The Mermaid syntax itself is valid (parsed with mermaid@11 + jsdom:
`PARSE OK: {"diagramType":"flowchart-v2"}`); only the branch coverage is at issue.

Suggested fix: add a `S1E -->|Changes requested| S1B` edge and include the two
missing nodes.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1; Mermaid syntax verified as valid, so
  the finding is limited to missing branches and missing nodes.
</details>

### ⏳ ⚪ F14 — No checkable exit criteria; "present" and "verify" undefined

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:40`

```
6. **User Review**: Present `.ai/cheatsheet.md` to the user and request review. **Stop here.** Do not attempt to merge into external files or Obsidian notes without explicit direction.
```

`skills/cheatsheet/SKILL.md:54`

```
6. **Vault Reporting**: Verify the file update in the vault and report completion to the user. Do not commit vault files to project Git unless the vault itself is explicitly a Git repository.
```

"Present" does not say whether to print the full content inline or name the path;
"Verify the file update" does not say how (re-read the file and confirm the new
sections, diff line counts, or trust the write). Neither stage states a condition
under which it is complete, so an agent cannot self-check before stopping.
Separately, "Stop here" (line 40) and "Wait for the user" (line 49) have no
defined behaviour in a non-interactive run, where no user turn will arrive.

Suggested fix: define presentation (path plus a short section inventory, full
content on request), define verification (re-read the target and confirm each
intended section is present and no pre-existing heading disappeared), and state
the non-interactive behaviour (produce Stage 1 only, never Stage 2).
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ ⚪ F15 — Ephemeral artifact has no disposal or retention rule

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:29`

```
### Stage 1: Ephemeral Cheatsheet Compilation (`.ai/cheatsheet.md`)
```

`skills/cheatsheet/SKILL.md:38`

```
   > **Do NOT commit `.ai/cheatsheet.md` to git.** This artifact is temporary by nature because every session generates its own distinct commands. …
```

The file is called ephemeral and temporary, but both exits — "Workflow Complete"
(line 22) and Stage 2 step 6 (line 54) — leave it in place with no statement
about deletion or retention. Combined with F5's missing collision rule, the next
session meets a stale file with no defined handling.

Suggested fix: state the retention rule explicitly (keep until the user says
otherwise, or delete after a successful vault merge) so the collision branch in
F5 has a basis.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ ⚪ F16 — File-level structure and language-identifier choice unspecified

<details>
<summary>Description</summary>

The canonical layout starts at H2,
`skills/cheatsheet/SKILL.md:63`

```
## <tool_name>
```

so the standalone `.ai/cheatsheet.md` has no defined title, H1, or frontmatter,
and no defined ordering between tool sections. Invariant 1 (lines 80–82) covers
only H2 and H3.

`skills/cheatsheet/SKILL.md:87`

```
3. **Code Blocks**: Always use fenced code blocks with language identifiers (`shell`, `bash`, `powershell`).
```

lists three identifiers without a selection rule, while the template hardcodes
` ```shell ` (lines 68, 74) — leaving PowerShell sessions (a realistic target,
given the identifier is listed) without a stated rule.

Suggested fix: define the file-level skeleton (H1 title, optional frontmatter,
section ordering) and one sentence on identifier selection (match the shell the
command was executed in).
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ ⚪ F17 — Vault metadata examples omit Obsidian properties, tags, and links

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:50`

```
2. **Audit Target Content First**: Read the target vault file completely. Inspect its existing structure, metadata headers (e.g., `# Meta`, `## Resources`), custom tags, and formatting style.
```

The only exemplified metadata is markdown headings. Obsidian notes commonly open
with a YAML properties block and carry `#tags` and `[[wikilinks]]` inline — the
items most easily damaged by a structural rewrite (F1) and the ones an agent is
least likely to treat as "sections". "custom tags" is mentioned but never tied to
a preservation action.

Suggested fix: name YAML frontmatter properties, inline tags, and wikilinks
explicitly in the audit and in the preservation rule.
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1.
</details>

### ⏳ ⚪ F18 — `.ai` naming collides with the other skill that owns that folder

<details>
<summary>Description</summary>

`skills/cheatsheet/SKILL.md:35`

```
3. **Storage Location (`.ai/cheatsheet.md`)**: Always save the draft cheatsheet inside the `.ai/` directory at the project root (e.g., `.ai/cheatsheet.md`). Create `.ai/` if it does not exist.
```

`skills/progress-tracking/SKILL.md:26-28` imposes a different rule on the same
folder:

```
Use the user's chosen workspace ahead of the shell's startup directory.
Otherwise use the active project root, or the current directory outside a project.
Store progress and auxiliary working artifacts under `.ai` at that root, each
named to end in `_progress.md`.
```

Where both skills are installed — the normal case in this repository's own
workspace — an agent gets two conflicting conventions for `.ai` artifact names
and two different definitions of the root (progress-tracking defines the
workspace/project/current-directory fallback chain that F5 finds missing here).

This is *not* an `AGENTS.md` self-sufficiency violation: the cheatsheet skill
correctly references no sibling file. The fix must therefore restate the needed
convention locally rather than link to it: "duplicate the few lines you need
instead of linking."

Suggested fix: state in this skill that the cheatsheet is a working artifact
distinct from progress records, and give it a name that cannot be mistaken for
one (or adopt the fallback-root wording verbatim, inline).
</details>

<details>
<summary>Status</summary>

State: ⏳ Awaiting triage · Severity: ⚪ Low
</details>

<details>
<summary>Updates</summary>

- 2026-09-18T10:43-04:00 — Raised in round 1. Verified by reading
  `skills/progress-tracking/SKILL.md` in full and grepping `.ai` across `skills/`.
</details>

## Resolved and discarded

*(empty — no finding has been triaged yet)*
