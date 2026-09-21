/**
 * Creates a review report with the structure report-format.md requires.
 *
 * The agent fills the skeleton in; update-dashboard.ts relies on it. Writing
 * the document freehand is what lets a section go missing, so the report is
 * always scaffolded first — the script refuses to touch a file that exists.
 *
 * The skeleton follows report-format.md's Intro spec, which defines the
 * wording this file writes and leaves as slots: `<base>` takes either form
 * the spec gives, **Rules** either its pairs or the spec's empty line,
 * **Commits** carries its empty-record line verbatim, and **Status** opens
 * `active since` the moment this script runs — the timestamp a first close
 * records as the state it left. The spec is the source; change it there
 * first.
 *
 * Usage: node scaffold-report.ts <report.md> [<target>]
 *
 * The target names what is under review. Omitted, it is written as a
 * placeholder; blank, it is refused — the title it would write is one
 * update-dashboard.ts rejects.
 *
 * Requires Node 24 or newer — it runs this TypeScript file directly, with no
 * build step and no dependencies.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

function stamp(now: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function skeleton(target: string): string {
  return `# Review — ${target}

## Intro

**Reviewed**

- Round 1 — \`<revision>\`, <base>; <clean or dirty tree>.

**Rules**

- \`<instruction file>\` → \`<paths in its scope>\` — <what it requires>.
- User's review questions — <the questions>.

**Commits**

- none recorded yet, the record trails by one

**Status** — active since ${stamp(new Date())}

## Dashboard

## Findings
`;
}

function main(): void {
  const [path, target] = process.argv.slice(2);
  if (!path) throw new Error("usage: node scaffold-report.ts <report.md> [<target>]");
  const name = target === undefined ? "<target>" : target.trim();
  if (name === "")
    throw new Error(
      "blank <target> — name what is under review, or omit the argument; '# Review — ' is a title update-dashboard.ts rejects",
    );
  if (existsSync(path)) throw new Error(`report already exists: ${path}`);

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, skeleton(name), "utf8");
  console.log(`Report scaffolded: ${path}`);
}

try {
  main();
} catch (error) {
  console.error(`scaffold-report: ${(error as Error).message}`);
  process.exit(1);
}
