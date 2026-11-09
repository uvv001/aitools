import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run as runSource, synopsis, COMMANDS } from '../src/cli.ts';
import type { CliEnvironment } from '../src/cli.ts';
import { annotationRef } from '../src/comment-ref.ts';
import { samplePullRequest } from '../src/fixtures.ts';
import { renderMarkdown } from '../src/markdown.ts';
import type { PullRequestData } from '../src/model.ts';
import { VERSION } from '../src/version.ts';
import { BEGIN_COMMAND_REFERENCE, END_COMMAND_REFERENCE, renderCommandReferenceMarkdown } from '../src/help-catalog.ts';
import { buildBundle, buildId, syncReadme } from './build.ts';

const run = promisify(execFile);

const work = resolve(import.meta.dirname, '..', 'out', 'bundle-test');
const bundle = join(work, 'pr-comments.mjs');
const sourceCli = resolve(import.meta.dirname, '..', 'src', 'cli.ts');
const prUrl = 'https://ghe.example.com/acme/widgets/pull/157';

// The sample pull request with one check run of two SonarQube annotations on its head commit.
const SONAR = 'sq-community-pr-decoration';
const MESSAGE = 'Refactor this method to reduce its Cognitive Complexity from 19 to 15.';
const ISSUE_REF = annotationRef(SONAR, 'src/retry.ts', 42, 42, MESSAGE);
const OTHER_REF = annotationRef(SONAR, 'src/retry.ts', 50, 55, 'Remove this commented out code.');
const withChecks = (): PullRequestData => ({
  ...samplePullRequest(),
  checkRuns: [
    {
      id: 9001,
      name: 'SonarQube Code Analysis',
      app: SONAR,
      status: 'completed',
      conclusion: 'failure',
      headSha: 'c'.repeat(40),
      detailsUrl: null,
      annotations: [
        { ref: ISSUE_REF, path: 'src/retry.ts', startLine: 42, endLine: 42, level: 'failure', title: null, message: MESSAGE, rawDetails: null },
        { ref: OTHER_REF, path: 'src/retry.ts', startLine: 50, endLine: 55, level: 'notice', title: null, message: 'Remove this commented out code.', rawDetails: null },
      ],
    },
  ],
});

async function bundled(args: string[], cwd = work) {
  try {
    const { stdout, stderr } = await run(process.execPath, [bundle, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

// The same command line run from the sources.
async function sourced(args: string[], cwd = work) {
  try {
    const { stdout, stderr } = await run(process.execPath, [sourceCli, ...args], { cwd });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr };
  }
}

// What `pr sync` would store, without GitHub: the sources run with a download that answers with `data`.
async function sync(db: string, data: PullRequestData): Promise<void> {
  const refused = async (): Promise<never> => {
    throw new Error('not available in this test');
  };
  const env: CliEnvironment = {
    getPullRequest: async () => data,
    publish: refused,
    reply: refused,
    resolveRevision: refused,
    print: () => undefined,
    warn: () => undefined,
    cwd: () => work,
    now: () => new Date(),
    readStdin: async () => new Uint8Array(),
  };
  await runSource(['pr', 'sync', '--db', db], env);
}

// A real git repository with one commit: its `.git` marks the repository root for the default review folder, and HEAD resolves.
async function makeRepository(dir: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const git = (...args: string[]) =>
    run('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: dir });
  await git('init', '-q');
  await git('commit', '--allow-empty', '-q', '-m', 'first');
  return (await git('rev-parse', '--short=8', 'HEAD')).stdout.trim();
}

describe('bundle', () => {
  beforeAll(async () => {
    await rm(work, { recursive: true, force: true });
    await buildBundle(bundle, 'test-build');
  });

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it('is one file that imports nothing but Node built-ins', async () => {
    const text = await readFile(bundle, 'utf8');
    const specifiers = [...text.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/g)].map(
      (match) => match[1] ?? match[2],
    );
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => !specifier?.startsWith('node:'))).toEqual([]);
  });

  it('starts with the shebang, followed by the generated-file notice', async () => {
    const [first, second] = (await readFile(bundle, 'utf8')).split('\n');
    expect(first).toBe('#!/usr/bin/env node');
    expect(second).toMatch(/^\/\/ Generated by "pnpm build"/);
  });

  it('reports the version and the build it was made from', async () => {
    for (const flag of ['--version', '-v']) {
      expect(await bundled([flag])).toMatchObject({ code: 0, stdout: `pr-comments ${VERSION}+test-build\n` });
    }
  });

  it('reports the version without a build id when it was built without one', async () => {
    const plain = join(work, 'plain.mjs');
    await buildBundle(plain, '');
    const { stdout } = await run(process.execPath, [plain, '--version']);
    expect(stdout).toBe(`pr-comments ${VERSION}\n`);
  });

  it('prints the same help as the source for the overview, a group and a command, with exit code 0', async () => {
    for (const args of [['--help'], ['help'], ['finding'], ['finding', '--help'], ['pr', 'sync', '-h'], ['help', 'round', 'open'], ['report', 'comments', '--help']]) {
      const [fromSource, fromBundle] = [await sourced(args), await bundled(args)];
      expect(fromBundle, args.join(' ')).toEqual(fromSource);
      expect(fromBundle.code).toBe(0);
      expect(fromBundle.stderr).toBe('');
    }
    const overview = (await bundled(['--help'])).stdout;
    for (const { words } of COMMANDS) expect(overview, words).toContain(words);
    expect((await bundled(['round', 'open', '--help'])).stdout).toContain(`Usage: ${synopsis(COMMANDS.find(({ words }) => words === 'round open')!)}`);
  }, 30_000);

  it('prints the same short error as the source and exits with 1', async () => {
    for (const args of [[], ['finding', 'list', '--bogus'], ['rule', 'add', 'x'], ['commit', 'add'], ['import', 'old_review.md'], ['frobnicate'], ['report', 'check'], ['pr', 'sync', '--db', 'review.md']]) {
      const [fromSource, fromBundle] = [await sourced(args), await bundled(args)];
      expect(fromBundle.code, args.join(' ')).toBe(1);
      expect(fromBundle, args.join(' ')).toEqual(fromSource);
      expect(fromBundle.stdout).toBe('');
    }
    expect((await bundled(['finding', 'list', '--bogus'])).stderr).toBe(
      `unknown option --bogus\nUsage: ${synopsis(COMMANDS.find(({ words }) => words === 'finding list')!)}\nRun "pr-comments finding list --help" for details.\n`,
    );
    for (const [args, name] of [[['rule', 'add', 'x'], 'rule'], [['commit', 'add'], 'commit'], [['import', 'old_review.md'], 'import']] as const) {
      expect((await bundled([...args])).stderr, args.join(' ')).toBe(`unknown command "${name}"\nRun "pr-comments help" for the commands.\n`);
    }
  }, 30_000);

  it('creates nothing for import, which is no command any more', async () => {
    const dir = join(work, 'old');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'old_review.md'), '# Review\n', 'utf8');

    expect(await bundled(['import', 'old_review.md'], dir)).toEqual({
      code: 1,
      stdout: '',
      stderr: 'unknown command "import"\nRun "pr-comments help" for the commands.\n',
    });
    expect(await readdir(dir)).toEqual(['old_review.md']);
  });

  it('prints the pull request of the database as markdown exactly like the source does', async () => {
    const dir = join(work, 'comments');
    await mkdir(dir, { recursive: true });
    const db = join(dir, 'review.sqlite');
    await bundled(['init', 'Demo', '--db', db, '--pr', prUrl]);
    const data = samplePullRequest();
    await sync(db, data);

    const result = await bundled(['report', 'comments', '--db', db]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toBe(renderMarkdown(data));
    expect((await bundled(['report', 'comments', '--db', db, '--author', 'carol'])).stdout).toBe(renderMarkdown(data, { authors: ['carol'] }));
  });

  it('prints the check annotations of the database exactly like the source does', async () => {
    const dir = join(work, 'checks');
    await mkdir(dir, { recursive: true });
    const db = join(dir, 'review.sqlite');
    await bundled(['init', 'Demo', '--db', db, '--pr', prUrl]);
    const data = withChecks();
    await sync(db, data);

    const result = await bundled(['report', 'comments', '--db', db]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(result.stdout).toBe(renderMarkdown(data));
    expect(result.stdout).toContain('## Checks\n\n### SonarQube Code Analysis — failure\n');
  });

  it('links a check annotation as a duplicate, refuses it as an own comment and as the target of a reply with exit code 1, and lists what is pending', async () => {
    const dir = join(work, 'annotations');
    await makeRepository(dir);
    const db = join(dir, 'review.sqlite');
    const description = join(dir, 'description.md');
    await writeFile(description, 'Text.\n', 'utf8');
    await bundled(['init', 'Demo', '--db', db, '--pr', prUrl], dir);
    await sync(db, withChecks());
    await bundled(['round', 'open', '--no-base', '--db', db], dir);
    await bundled(['finding', 'add', '--db', db, '--severity', 'high', '--title', 'Demo finding', '--description-file', description], dir);
    const before = await readFile(db);

    const own = await bundled(['link', 'own', '--db', db, 'F1', ISSUE_REF], dir);
    expect(own).toMatchObject({ code: 1, stdout: '' });
    expect(own.stderr).toContain(`${ISSUE_REF} is a check annotation: it can only be linked as a duplicate of a finding`);
    const reply = await bundled(['link', 'reply', '--db', db, ISSUE_REF], dir);
    expect(reply).toMatchObject({ code: 1, stdout: '' });
    expect(reply.stderr).toContain(`${ISSUE_REF} is a check annotation; there is nothing to reply to`);
    const unknown = await bundled(['link', 'duplicate', '--db', db, 'F1', 'r999'], dir);
    expect(unknown).toMatchObject({ code: 1, stdout: '' });
    expect(unknown.stderr).toContain(`r999 is not in the database; run "pr-comments pr sync --db ${db}" first, or check the id`);
    expect((await readFile(db)).equals(before)).toBe(true);

    const linked = await bundled(['link', 'duplicate', '--db', db, 'F1', ISSUE_REF], dir);
    expect(linked).toMatchObject({ code: 0, stdout: `F1: duplicate ${ISSUE_REF} linked\n`, stderr: 'Review database: review.sqlite\n' });
    const shown = await bundled(['finding', 'show', '--db', db, 'F1'], dir);
    expect(shown.stdout).toContain(`### ⏳ 🔴 F1 — Demo finding\nLinked: duplicate ${ISSUE_REF}\n`);

    const pendingBefore = await readFile(db);
    const pending = await bundled(['link', 'pending', '--db', db], dir);
    expect(pending).toMatchObject({ code: 0, stderr: '' });
    expect(pending.stdout).toMatch(new RegExp(`\\n? *${OTHER_REF} +${SONAR} +notice +src/retry\\.ts:50-55 +"Remove this commented out code\\."`));
    expect(pending.stdout).not.toContain(ISSUE_REF);
    expect(pending.stdout).toContain('r1001');
    expect((await readFile(db)).equals(pendingBefore)).toBe(true);
  });

  it('creates a review, adds a finding and renders the report from another folder', async () => {
    const elsewhere = join(work, 'elsewhere');
    const head = await makeRepository(elsewhere);
    const report = join(elsewhere, 'review.md');
    const db = join(elsewhere, 'review.sqlite');
    const description = join(elsewhere, 'description.md');
    await writeFile(description, 'Text.\n', 'utf8');

    const init = await bundled(['init', 'Demo', '--db', db, '--pr', prUrl], elsewhere);
    expect(init.stdout).toBe(
      `Created review.sqlite\nPull request: ${prUrl}\nReport: review.md\n`,
    );
    expect((await bundled(['pr', 'show', '--db', db], elsewhere)).stdout).toBe(`${prUrl}\nnot synced yet; run "pr-comments pr sync --db ${db}"\n`);

    const round = await bundled(['round', 'open', '--db', db, '--no-base'], elsewhere);
    expect(round).toMatchObject({ code: 0, stdout: 'Round 1 opened\n', stderr: 'Review database: review.sqlite\n' });

    const add = ['finding', 'add', '--db', db, '--severity', 'high', '--title', 'Demo finding', '--description-file', description];
    expect((await bundled(add, elsewhere)).stdout).toBe('Added F1\n');

    const rendered = await bundled(['report', 'render', '--db', db], elsewhere);
    expect(rendered.stdout).toBe(`unchanged ${report}\n`);
    const text = await readFile(report, 'utf8');
    expect(text).toContain('### ⏳ 🔴 F1 — Demo finding');
    expect(text).toContain(`Round 1 — \`${head}\`, base none`);
  });

  it('requires --db on commands that work on an existing review', async () => {
    const tree = join(work, 'tree');
    await makeRepository(tree);
    await bundled(['init', 'Demo', '--pr', prUrl], tree);

    for (const args of [['pr', 'show'], ['round', 'open', '--no-base'], ['finding', 'list'], ['report', 'render']]) {
      const result = await bundled(args, tree);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('--db is required');
    }
  });

  it('fails with the message and exit code 1 on a database that does not exist, creating nothing', async () => {
    const missing = join(work, 'nothing.sqlite');

    for (const args of [['finding', 'list'], ['pr', 'sync'], ['finding', 'update', 'F1', 'x'], ['report', 'render'], ['link', 'pending']]) {
      const result = await bundled([...args, '--db', missing]);
      expect(result.code, args.join(' ')).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`${missing} does not exist`);
    }
    expect((await readdir(work)).includes('nothing.sqlite')).toBe(false);
  });

  it('fails with the message and exit code 1 on a file that is not a review database, leaving it untouched', async () => {
    const db = join(work, 'broken.sqlite');
    await writeFile(db, 'not a database', 'utf8');

    const result = await bundled(['finding', 'list', '--db', db]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('is not a review database');
    expect(await readFile(db, 'utf8')).toBe('not a database');
  });

  it('scopes the buildId -dirty suffix to tracked files under the package root', async () => {
    const repo = join(work, 'dirty-scope-repo');
    const pkgRoot = join(repo, 'tools', 'pr-comments');
    const skillDir = join(repo, 'skills', 'review-with-docs');
    await makeRepository(repo);
    await mkdir(pkgRoot, { recursive: true });
    await mkdir(skillDir, { recursive: true });
    await writeFile(join(pkgRoot, 'src.ts'), 'export const x = 1;\n', 'utf8');
    await writeFile(join(skillDir, 'pr-comments.mjs'), '// bundle\n', 'utf8');
    const gitConfig = ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false'];
    await run('git', [...gitConfig, 'add', '.']);
    await run('git', [...gitConfig, 'commit', '-q', '-m', 'add files']);
    const head = (await run('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'])).stdout.trim();

    expect(buildId(pkgRoot)).toBe(head);

    await writeFile(join(skillDir, 'pr-comments.mjs'), '// modified bundle\n', 'utf8');
    expect(buildId(pkgRoot)).toBe(head);

    await writeFile(join(pkgRoot, 'src.ts'), 'export const x = 2;\n', 'utf8');
    expect(buildId(pkgRoot)).toBe(`${head}-dirty`);
  });

  it('syncs a stale README command reference and skips writing when already in sync', async () => {
    const readme = join(work, 'README.md');
    await writeFile(readme, `# Demo\n\n${BEGIN_COMMAND_REFERENCE}\noutdated\n${END_COMMAND_REFERENCE}\n`, 'utf8');

    expect(await syncReadme(readme)).toBe(true);
    expect(await readFile(readme, 'utf8')).toBe(
      `# Demo\n\n${BEGIN_COMMAND_REFERENCE}\n${renderCommandReferenceMarkdown()}\n${END_COMMAND_REFERENCE}\n`,
    );
    expect(await syncReadme(readme)).toBe(false);
  });
});
