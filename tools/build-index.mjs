#!/usr/bin/env node
// Generates the autodiscovery manifests for the skills/ and agents/
// catalogs:
//
//   index.json          all skills and agents, paths relative to the root
//   skills/index.json   skills only, paths relative to skills/
//   agents/index.json   agents only, paths relative to agents/
//
// A harness points at one of these folders' URL and fetches its index.json;
// every `path` resolves against that folder. Regenerate after changing
// anything under skills/ or agents/:
//
//   node tools/build-index.mjs
//
// Frontmatter support is intentionally minimal: plain scalars (single- or
// multi-line) and block scalars (`>`, `>-`, `|`, `|-`), which are folded to
// one space-joined line. Quoted scalars are rejected. Only `name` and
// `description` are read.

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function toPosix(path) {
  return path.split(sep).join('/');
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const fields = {};
  let key = null;
  let parts = null;
  const flush = () => {
    if (parts) {
      fields[key] = parts.join(' ');
      parts = null;
      key = null;
    }
  };
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*([^\r\n]*)$/);
    if (kv) {
      flush();
      const value = kv[2].trim();
      if (value === '>' || value === '>-' || value === '|' || value === '|-') {
        // block scalars are folded to a single space-joined line
        key = kv[1];
        parts = [];
      } else if (value.startsWith('"') || value.startsWith("'")) {
        throw new Error(`unsupported quoted scalar for "${kv[1]}"; use a plain or folded (>) scalar`);
      } else if (value) {
        // plain scalar; may continue on following indented lines
        key = kv[1];
        parts = [value];
      }
    } else if (parts && /^\s+\S/.test(line)) {
      parts.push(line.trim());
    } else if (!/^\s*$/.test(line) && !/^\s/.test(line)) {
      flush();
    }
  }
  flush();
  return fields;
}

function fileEntry(absPath) {
  // hash the content git serves: .gitattributes normalizes text to LF
  const content = readFileSync(absPath, 'utf8').replace(/\r\n/g, '\n');
  return {
    path: toPosix(relative(root, absPath)),
    sha256: createHash('sha256').update(content).digest('hex'),
  };
}

function collectFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...collectFiles(abs));
    else files.push(abs);
  }
  return files;
}

function catalogEntry(expectedName, entryFile, files) {
  const frontmatter = parseFrontmatter(readFileSync(entryFile, 'utf8'));
  for (const field of ['name', 'description']) {
    if (!frontmatter[field]) {
      throw new Error(`${toPosix(relative(root, entryFile))}: missing frontmatter field "${field}"`);
    }
  }
  if (frontmatter.name !== expectedName) {
    throw new Error(
      `${toPosix(relative(root, entryFile))}: frontmatter name "${frontmatter.name}" does not match "${expectedName}"`,
    );
  }
  return {
    name: frontmatter.name,
    description: frontmatter.description,
    path: toPosix(relative(root, entryFile)),
    // sort by posix path: native separators would order differently per OS
    files: files
      .map(fileEntry)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

const skills = readdirSync(join(root, 'skills'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => {
    const dir = join(root, 'skills', name);
    return catalogEntry(name, join(dir, 'SKILL.md'), collectFiles(dir));
  });

const agents = readdirSync(join(root, 'agents'))
  .filter((file) => file.endsWith('.md'))
  .sort()
  .map((file) => {
    const abs = join(root, 'agents', file);
    return catalogEntry(file.replace(/\.md$/, ''), abs, [abs]);
  });

// Re-express a root-relative entry against the folder its manifest lives in.
function stripPrefix(entry, prefix) {
  return {
    ...entry,
    path: entry.path.slice(prefix.length),
    files: entry.files.map((file) => ({ ...file, path: file.path.slice(prefix.length) })),
  };
}

function writeIndex(relPath, manifest) {
  writeFileSync(join(root, relPath), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Wrote ${relPath}`);
}

writeIndex('index.json', {
  schemaVersion: '1',
  name: 'aitools',
  description: 'A library of skill, prompt, and agent definitions.',
  skills,
  agents,
});
writeIndex('skills/index.json', {
  schemaVersion: '1',
  skills: skills.map((entry) => stripPrefix(entry, 'skills/')),
});
writeIndex('agents/index.json', {
  schemaVersion: '1',
  agents: agents.map((entry) => stripPrefix(entry, 'agents/')),
});
console.log(`${skills.length} skills, ${agents.length} agents.`);
