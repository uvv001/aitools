# aitools

A library of skill, prompt, and agent definitions. Each skill lives in its own
directory under `skills/`.

## Skill authoring

- Keep each skill self-sufficient: reference only files inside its own
  directory. Skills install one at a time, so a pointer into a sibling skill's
  files breaks whenever that sibling is absent — duplicate the few lines you
  need instead of linking.

## Catalog index

`index.json` (root, `skills/`, and `agents/`) is the generated discovery
manifest — never edit it by hand. After adding, removing, or editing
anything under `skills/` or `agents/`, run `node tools/build-index.mjs` and
commit the updated manifests.

## Commits

Subject line, 75 characters or fewer: `<category>: <entity> — <summary>`.
Anything longer belongs in the body, after a blank line.

Category and entity come from the path: `skills/progress-tracking/` gives
`skill: progress-tracking`, `agents/web-ui-inspector.md` gives
`agent: web-ui-inspector`, and a root-level file gives `repo: AGENTS.md`.
The summary is optional when the entity name already carries the change.

- `skill: progress-tracking — require _progress file suffix`
- `agent: web-ui-inspector`
- `repo: AGENTS.md — document the commit message format`
