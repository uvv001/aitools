# Fleet board

The machine state for one implementation effort — one board per effort,
living where the process proposal names. A dependency wave reads across
stage boundaries, so the board outlives any single stage.

Two columns: the component, and its description. Theses linked to
artifacts, not narratives — an entry answers the standing questions, and a
linked artifact tells the story.

## Shape

| Component | Description |
|---|---|

The component cell carries the name and the status icon, so a scan down
column one reads the whole effort. The description holds these sections, in
this order, each appearing once it becomes true:

- **Bench** — worktree, branch, port, and worker session id on one line,
  so the work can be found, served, resumed, or its traces attached.
- **Demo** — the showcase URL as a clickable link, while the component is
  being served; plus the latest commit.
- **Progress** — dated theses, newest first, from both sides of the loop:
  the agent's milestones (states built, rungs run, with evidence — test
  output, screenshot, URL) and the developer's feedback (each review
  round's defect list, each approval). A review's defects live here: the
  developer's message is the source, the entry is its thesis.

## States

| Icon | State | Meaning |
|---|---|---|
| ⬜ | planned | scoped, not yet dispatched |
| 🚧 | in progress | worker dispatched |
| 🔍 | awaiting review | worker reported complete; presented to the developer |
| ✅ | approved | explicitly approved by the developer |
| ⏸️ | parked | blocked mid-flight; the entry names the blocker and what clears it |

An edit to approved work reverts the icon to 🔍.

## Example

| Component | Description |
|---|---|
| **icons** ✅ | `worktrees/<feature>_icons` · branch `<feature>/icons` · port 4201 · session `680994b6…`<br>Demo: [:4201/icons](http://localhost:4201/icons) · commit `00db99d`<br>**Progress**<br>- 08-31 19:20 developer: approved<br>- 08-31 19:05 worker: 12 states built, UTs green, demo verified at 1280px |
| **filter-tree** 🔍 | `worktrees/<feature>_filter-tree` · branch `<feature>/filter-tree` · port 4202 · session `7c1e…`<br>Demo: [:4202/filter-tree](http://localhost:4202/filter-tree) · commit `b3f41c2`<br>**Progress**<br>- 09-01 11:02 developer review 1: tree has border absent from mockup; hover overrides selected background<br>- 09-01 10:40 worker: rungs 1–4 green; e2e n/a, no local backend |
| **details-card** ⬜ | waits on icons, badge |
| **empty-state** ⏸️ | `worktrees/<feature>_empty-state` · port 4203 · session `a91f…`<br>**Progress**<br>- 09-01 12:15 worker: live reference down mid-measure; resumes on restore |

## Rules

- A worker's row exists at ⬜ from the moment its bench is assigned, ahead
  of the dispatch; a report's receipt lands as progress entries the same
  turn.
- The board is the machine state; the session's progress record is the
  narrative. The record links the board and logs dispatch and report
  receipt separately.
- Waves read the board: a component dispatches when every component it
  consumes shows ✅.
