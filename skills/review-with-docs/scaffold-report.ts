/**
 * Creates a review report with the structure report-format.md requires.
 *
 * The agent fills the skeleton in; update-dashboard.ts relies on it. Writing
 * the document freehand is what lets a section go missing, so the report is
 * always scaffolded first — the script refuses to touch a file that exists.
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

function skeleton(target: string): string {
  return `# Review — ${target}

## Intro

**Reviewed**

- Round 1 — \`<revision>\`, base \`<revision>\` — or \`base none — reviewed as it stands\`; <clean or dirty tree>.

**Rules**

- \`<instruction file>\` → \`<paths in its scope>\` — <what it requires>.
- User's review questions — <the questions>.

**Commits**

- none recorded yet, the record trails by one

**Status** — active

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
