# aitools

A library of skill, prompt, and agent definitions. Each skill lives in its own
directory under `skills/`.

## Skill authoring

- Keep each skill self-sufficient: reference only files inside its own
  directory. Skills install one at a time, so a pointer into a sibling skill's
  files breaks whenever that sibling is absent — duplicate the few lines you
  need instead of linking.
