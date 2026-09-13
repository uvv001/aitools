# aitools

A library of skill and agent definitions. Each skill lives in its own
directory under `skills/`, each agent in a single markdown file under
`agents/`.

## Catalog discovery

`index.json` is the machine-readable catalog, generated in three places so a
harness can point at whichever folder it cares about:

- `index.json` — all skills and agents, paths relative to the root
- `skills/index.json` — skills only, paths relative to `skills/`
- `agents/index.json` — agents only, paths relative to `agents/`

To consume one, point a harness at the folder's URL, for example:

```
https://raw.githubusercontent.com/uvv001/aitools/master/
```

The harness fetches `<base>/index.json` and discovers every entry. Each
entry's `path` — and every `files[].path` — resolves against the same base
URL, e.g. `skills/progress-tracking/SKILL.md` becomes
`<base>/skills/progress-tracking/SKILL.md`.

Manifest shape:

- Root manifest: `schemaVersion`, `name`, `description`, `skills[]`,
  `agents[]`. Folder manifests carry only the relevant array.
- Entry: `name`, `description`, `path` (entrypoint file), `files[]`.
- File: `path`, `sha256` — usable for integrity checks and cache
  invalidation. Skills bundle supporting files, so fetch every entry in
  `files[]` when installing one.

Load only the manifest for routing; fetch an entrypoint's content lazily,
when the skill or agent is invoked.

`raw.githubusercontent.com` rate-limits unauthenticated calls; for
high-traffic or browser-based harnesses, serve the same paths via GitHub
Pages or jsDelivr (`https://cdn.jsdelivr.net/gh/uvv001/aitools@master/`)
instead.

## Regenerating the index

The manifests are generated — never edit them by hand. After adding,
removing, or editing anything under `skills/` or `agents/`, run:

```
node tools/build-index.mjs
```

and commit the result.
