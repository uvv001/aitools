# Swarm lane protocol

Operational reference for exact-model delegation via the `swarm` tool. Read this
before your first `swarm` call in a session. Model names and fallbacks live in
[models.md](models.md).

## 1. Pre-flight quota check

Before adding a worker on a separate-quota or Tier 1 model, inspect live
availability:

- Call `swarm{action:"models", all:true}` to verify exact accepted model names
  and check `quota_remaining` / `quota_resets` (and `quota_note` if AI credits
  cover overages).
- If the target model is exhausted and uncovered by credits, route immediately
  to the fallback lane/model in [models.md](models.md) instead of calling `add`,
  and note the quota-driven fallback.

## 2. Lean roster and brief hygiene

- **Name the swarm once** (`swarm{action:"title", title:"<short goal>"}`) when
  opening the lane.
- **Spawn only task workers** named for their job (`impl-auth`, `review-auth`).
  Omit `narrator` and `monitor` unless the user explicitly asks for them.
- **Pin `model` explicitly** on every `swarm{action:"add"}` call using an exact
  name from [models.md](models.md) verified in Section 1.
- **Write self-contained, secret-free briefs.** Workers start with a clean
  context and every brief is public on the shared board. State exact file scope,
  non-goals, verification commands, and completion format: instruct the worker
  to post `@coordinator [done] <concise summary, changed paths, verification
  evidence>` (or `@coordinator [blocked] <cause>`).
- **Enforce read-only roles in the brief.** `swarm` workers have full tools; for
  reviewers and challengers, state explicitly in the brief that they must not
  edit files or run mutating commands.

## 3. Board turn lifecycle and waiting

- **One-turn board-tool arrival:** `post_message`, `read_board`, and
  `swarm_wait` appear on the turn *after* your first `swarm{action:"add"}`. On
  the startup turn, add the needed worker(s) with complete briefs and end the
  turn cleanly.
- **Wait passively, reference by `#seq`:** Use `swarm_wait{since:<last_seq>}`
  rather than polling `read_board` in a loop. Refer to earlier posts by sequence
  number (`#4`) instead of copy-pasting worker output across posts.
- **Target `@mentions` tightly:** Mention only the member that must act next
  (`@impl-auth`). Reserve `@all` for shared decisions affecting every worker.

## 4. Mid-run quota failover (hot-swap)

When a worker pauses on quota exhaustion or receives a `[quota]` warning:

1. Check `swarm{action:"status"}` and wait until the worker is `waiting` (do not
   switch a `working` worker mid-turn).
2. Keep the worker alive — **never `kill` and re-`add` for quota exhaustion**.
   Call `swarm{action:"model", name:"<worker>", model:"<fallback from models.md>"}`
   so it retains its full conversation history and resumes where it stopped.
3. Inform the user which model ran out and which fallback model took over, and
   record the switch in continuity notes.

## 5. Workspaces, landing, and teardown

- **Isolate concurrent writers:** Pass `workspace:"share"` (or `"branch"` for a
  full clone) whenever multiple workers edit or build concurrently. Keep
  single-writer workers and all read-only reviewers on `workspace:"inherit"`.
- **Land before killing:** `swarm{action:"kill"}` is permanent and **deletes**
  any `share` or `branch` workspace. Have the worker commit its work, then
  merge or cherry-pick those commits into the main workspace and verify before
  calling `kill`.
- **Reuse or retire cleanly:** `waiting` workers cost zero tokens and can handle
  review fixes via `@<worker>`. Once a worker's task is verified and landed (and
  no follow-up is expected), kill it so future board posts do not leak into
  unrelated work.
