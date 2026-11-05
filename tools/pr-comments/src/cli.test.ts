import { execFile, spawnSync } from 'node:child_process';
import { access, chmod, copyFile, link, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COMMANDS, defaultEnvironment, readFailure, run, synopsis } from './cli.ts';
import type { CliEnvironment } from './cli.ts';
import { annotationRef } from './comment-ref.ts';
import { samplePullRequest } from './fixtures.ts';
import { resolveRevision } from './git-revision.ts';
import { renderMarkdown } from './markdown.ts';
import type { AnnotationLevel, CheckAnnotation, CheckRun, PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import type { PublishComment, PublishOptions, PublishResult } from './publish.ts';
import { AGENT_DISCLAIMER } from './publish.ts';
import type { ReplyOptions, ReplyRequest, ReplyResult, ReplyTarget } from './reply.ts';
import { parseReport } from './report-parse.ts';
import { dumpReviewFile, loadReviewFile, loadSnapshot, reviewPaths } from './review-files.ts';
import { pendingItems, pendingLines } from './review-pending.ts';
import { renderReport } from './review-render.ts';
import { removeScratch, scratchDir } from './review-test-support.ts';
import { VERSION } from './version.ts';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
  };
});

const execFileAsync = promisify(execFile);
const CLI = join(import.meta.dirname, 'cli.ts');

const prUrl = 'https://ghe.example.com/acme/widgets/pull/157';
const PR_REF: PullRequestRef = { host: 'ghe.example.com', owner: 'acme', repo: 'widgets', number: 157 };
// Local time, which is what the review stamps; the stamp reads 2026-10-09 14:30.
const NOW = new Date(2026, 9, 9, 14, 30);
const STAMP = '2026-10-09 14:30';
// The comments as the Updates of the report name them: the id linked to the comment on the pull request.
const LINKED = {
  r1001: '[r1001](https://ghe.example.com/acme/widgets/pull/157#discussion_r1001)',
  r1004: '[r1004](https://ghe.example.com/acme/widgets/pull/157#discussion_r1004)',
  c2001: '[c2001](https://ghe.example.com/acme/widgets/pull/157#issuecomment-2001)',
  r2001: '[r2001](https://ghe.example.com/acme/widgets/pull/157#discussion_r2001)',
  r546201: '[r546201](https://ghe.example.com/acme/widgets/pull/157#discussion_r546201)',
  c624100: '[c624100](https://ghe.example.com/acme/widgets/pull/157#issuecomment-624100)',
};

// What the fake git answers: the 8-character hash of the commit.
const HASHES: Record<string, string> = { HEAD: '1a2b3c4d', 'origin/main': '5e6f7a8b', feature: '9c0d1e2f', abc1234: 'abc12345' };

const SONAR = 'sq-community-pr-decoration';
const COMPLEXITY = 'Refactor this method to reduce its Cognitive Complexity from 19 to 15.';
const ELSE_IF = "'If' statement should not be the only statement in 'else' block";
const COMMENTED_OUT = 'Remove this commented out code.';
const UNUSED = "'x' is assigned a value but never used.";

// An annotation the way GitHub gives it: the ref is computed from the app, path, lines and message, as sync does.
function annotation(app: string, path: string, startLine: number, endLine: number, level: AnnotationLevel, message: string): CheckAnnotation {
  const ref = annotationRef(app, path, startLine, endLine, message);
  return { ref, path, startLine, endLine, level, title: `${path}#L${startLine}`, message, rawDetails: null };
}

// SonarQube's three issues and a lint warning, on the head commit of the sample pull request.
const checkRuns = (): CheckRun[] => [
  {
    id: 9001,
    name: 'SonarQube Code Analysis',
    app: SONAR,
    status: 'completed',
    conclusion: 'failure',
    headSha: 'c'.repeat(40),
    detailsUrl: 'https://sonar.example.com/dashboard?id=widgets&pullRequest=157',
    annotations: [
      annotation(SONAR, 'src/retry.ts', 42, 42, 'failure', COMPLEXITY),
      annotation(SONAR, 'src/retry.ts', 50, 55, 'warning', ELSE_IF),
      annotation(SONAR, 'docs/readme.md', 5, 5, 'notice', COMMENTED_OUT),
    ],
  },
  {
    id: 9002,
    name: 'Lint',
    app: 'github-actions',
    status: 'completed',
    conclusion: 'neutral',
    headSha: 'c'.repeat(40),
    detailsUrl: null,
    annotations: [annotation('github-actions', 'src/util.ts', 7, 7, 'warning', UNUSED)],
  },
];
const withChecks = (): PullRequestData => ({ ...samplePullRequest(), checkRuns: checkRuns() });
const [COMPLEXITY_REF, ELSE_IF_REF, COMMENTED_OUT_REF, UNUSED_REF] = checkRuns().flatMap((checkRun) =>
  checkRun.annotations.map(({ ref }) => ref),
) as [string, string, string, string];

// The sample with check annotations and more comments of the user, as GitHub gives it after the user posted them.
function withComments(...refs: string[]): PullRequestData {
  const data = withChecks();
  const [template] = data.comments;
  const added = refs.map((ref) => ({
    ...template!,
    id: `id-${ref}`,
    kind: ref.startsWith('r') ? ('review' as const) : ('issue' as const),
    author: 'me',
    body: `Comment ${ref}.`,
    url: ref.startsWith('r') ? `${prUrl}#discussion_${ref}` : `${prUrl}#issuecomment-${ref.slice(1)}`,
  }));
  return { ...data, comments: [...data.comments, ...added] };
}

const WORDS = COMMANDS.map(({ words }) => words);
const GROUPS = ['pr', 'round', 'finding', 'link', 'report'];
const CREATING = ['init'];
const READONLY = ['pr show', 'finding list', 'finding show', 'link pending', 'report render', 'report comments', 'report dump'];
const WITH_JSON = ['pr show', 'finding add', 'finding list', 'finding show', 'finding post', 'link pending', 'link reply'];
const CHANGING = WORDS.filter((words) => !CREATING.includes(words) && !READONLY.includes(words));
const DATABASE_COMMANDS = WORDS.filter((words) => !CREATING.includes(words));

const command = (words: string) => COMMANDS.find((candidate) => candidate.words === words)!;

// The error of a mistake in the arguments of a command: the problem, the command's one usage line and the way to its help.
const mistake = (words: string, problem: string) =>
  new Error(`${problem}\nUsage: ${synopsis(command(words))}\nRun "pr-comments ${words} --help" for details.`);

const DASH = 'to give a text that starts with "-", put options such as --db first, then -- and the text';

const F1_DESCRIPTION = [
  'Crash when the list is empty; see [the helper](src/util.ts).',
  '',
  '`src/app.ts:10-12`',
  '',
  'Second place, same cause.',
  '',
  '`src/other.ts:7`',
].join('\n');

describe('cli', () => {
  let work: string;
  let docs: string;
  let review: string;
  let printed = '';
  let warned = '';
  let stdin: string | Uint8Array = '';
  let snapshot: PullRequestData = withChecks();
  let downloads: PullRequestRef[] = [];
  let revisions: string[] = [];
  let env: CliEnvironment;

  function makeEnv(cwd: string): CliEnvironment {
    return {
      getPullRequest: async (ref) => {
        downloads.push(ref);
        return snapshot;
      },
      publish: async () => {
        throw new Error('publish must not be called');
      },
      reply: async () => {
        throw new Error('reply must not be called');
      },
      resolveRevision: async (revision) => {
        revisions.push(revision);
        const hash = HASHES[revision];
        if (hash === undefined) throw new Error(`revision "${revision}" does not exist in this repository`);
        return hash;
      },
      print: (text) => {
        printed += text;
      },
      warn: (text) => {
        warned += text;
      },
      cwd: () => cwd,
      now: () => NOW,
      readStdin: async () => (typeof stdin === 'string' ? Buffer.from(stdin, 'utf8') : stdin),
    };
  }

  // A review with the sample pull request connected and synced (with check annotations), one round and three findings:
  // F1 and F2 approved (F1 has two anchors, F2 none), F3 awaiting triage. Built once, copied for every test.
  let templateDir: string;
  let template: string;

  beforeAll(async () => {
    templateDir = scratchDir();
    await mkdir(join(templateDir, 'docs'), { recursive: true });
    template = join(templateDir, 'docs', 'demo_review.sqlite');
    const setup = makeEnv(templateDir);
    const go = (...args: string[]) => run([...args, '--db', template], setup);
    const add = (severity: string, title: string, description: string) => {
      stdin = description;
      return go('finding', 'add', '--severity', severity, '--title', title, '--description-file', '-');
    };
    await run(['init', 'Demo', '--db', template, '--pr', prUrl], setup);
    await go('pr', 'sync');
    await go('round', 'open', '--no-base');
    await add('high', 'Missing timeout', F1_DESCRIPTION);
    await add('medium', 'Remark', 'A remark that belongs to no line.');
    await add('low', 'Waiting', 'Not yet.');
    await go('finding', 'set-state', 'F1', 'approved');
    await go('finding', 'set-state', 'F2', 'approved');
    downloads = [];
    revisions = [];
  }, 60_000);

  afterAll(() => removeScratch(templateDir));

  beforeEach(async () => {
    work = scratchDir();
    // A folder with a `.git` marks the git root for the scratch directory, away from the repository this test runs in.
    await mkdir(join(work, '.git'));
    docs = join(work, 'docs');
    await mkdir(docs);
    review = join(docs, 'demo_review.sqlite');
    await copyFile(template, review);
    printed = '';
    warned = '';
    stdin = 'Some text.';
    snapshot = withChecks();
    downloads = [];
    revisions = [];
    env = makeEnv(work);
  });

  afterEach(() => removeScratch(work));

  const step = async (...args: string[]) => {
    printed = '';
    warned = '';
    const hasDb = args.some((arg) => arg === '--db' || arg.startsWith('--db=') || arg === '--help' || arg === '-h');
    const needsDb =
      !hasDb &&
      args[0] !== 'help' &&
      DATABASE_COMMANDS.some((words) => {
        const parts = words.split(' ');
        return parts.every((part, idx) => args[idx] === part);
      });
    return run(needsDb ? ['--db', review, ...args] : args, env);
  };
  const exists = (path: string) => access(path).then(() => true, () => false);
  const bytes = () => readFile(review);
  const tree = async (dir = work) => (await readdir(dir, { recursive: true })).sort();
  const loaded = () => loadReviewFile(review);
  const findingOf = async (id: string) => (await loaded()).data.findings.find((finding) => finding.id === id);
  const updatesOf = async (id: string) => (await findingOf(id))?.updates.map(({ text }) => text);
  const shown = (path: string) => relative(work, path);
  const line = (path = review) => `Review database: ${shown(path)}\n`;

  // The command fails with that message, prints nothing, and leaves the database byte for byte as it was.
  async function fails(args: string[], message: string | RegExp | Error): Promise<void> {
    const before = await bytes();
    await expect(step(...args)).rejects.toThrow(message);
    expect(printed).toBe('');
    expect(warned).toBe('');
    expect((await bytes()).equals(before)).toBe(true);
  }

  // The invocation of every command that works as it stands on the database of the template, as the tests below need it.
  const valid = (words: string): string[] =>
    ({
      init: ['init', 'Second'],
      'pr connect': ['pr', 'connect', prUrl],
      'pr show': ['pr', 'show'],
      'pr sync': ['pr', 'sync'],
      'round open': ['round', 'open', '--no-base'],
      'round update': ['round', 'update', 'no findings'],
      'finding add': ['finding', 'add', '--severity', 'low', '--title', 'Four', '--description-file', '-'],
      'finding list': ['finding', 'list'],
      'finding show': ['finding', 'show', 'F1'],
      'finding set-state': ['finding', 'set-state', 'F3', 'approved'],
      'finding set-severity': ['finding', 'set-severity', 'F3', 'high'],
      'finding set-title': ['finding', 'set-title', 'F3', 'Other'],
      'finding set-description': ['finding', 'set-description', 'F3', '--description-file', '-'],
      'finding update': ['finding', 'update', 'F3', 'a note'],
      'finding post': ['finding', 'post', 'F1', '--dry-run'],
      'link pending': ['link', 'pending'],
      'link own': ['link', 'own', 'F3', 'r1001'],
      'link duplicate': ['link', 'duplicate', 'F3', 'r1002'],
      'link note': ['link', 'note', 'r1004', 'a bot'],
      'link remove': ['link', 'remove', 'r1001'],
      'link reply': ['link', 'reply', 'r1002', '--dry-run'],
      'report render': ['report', 'render'],
      'report comments': ['report', 'comments'],
      'report dump': ['report', 'dump'],
    })[words]!;

  describe('the command table', () => {
    it('has the commands of the command line, no others', () => {
      expect(WORDS).toEqual([
        'init',
        'pr connect',
        'pr show',
        'pr sync',
        'round open',
        'round update',
        'finding add',
        'finding list',
        'finding show',
        'finding set-state',
        'finding set-severity',
        'finding set-title',
        'finding set-description',
        'finding update',
        'finding post',
        'link pending',
        'link own',
        'link duplicate',
        'link note',
        'link remove',
        'link reply',
        'report render',
        'report comments',
        'report dump',
      ]);
    });

    it('says for each command whether it needs the database and how: init creates it, the pure reads open it read-only', () => {
      for (const { words, database } of COMMANDS) {
        const expected = CREATING.includes(words) ? 'none' : READONLY.includes(words) ? 'readonly' : 'change';
        expect(database, words).toBe(expected);
      }
    });

    it('declares --json for the commands whose result a program acts on, and --db for all', () => {
      for (const { words, options } of COMMANDS) {
        const names = options.map(({ name }) => name);
        expect(names.includes('json'), words).toBe(WITH_JSON.includes(words));
        expect(names.includes('db'), words).toBe(true);
      }
    });

    it('declares only --author and --ref as repeatable, the finding texts and --db as required, and the base of a round as one of two', () => {
      const flagged = (key: 'repeatable' | 'required') =>
        COMMANDS.flatMap(({ words, options }) => options.filter((option) => option[key]).map(({ name }) => `${words} --${name}`));
      expect(flagged('repeatable')).toEqual(['report comments --author', 'report comments --ref']);
      expect(flagged('required')).toEqual([
        'pr connect --db',
        'pr show --db',
        'pr sync --db',
        'round open --db',
        'round update --db',
        'finding add --severity',
        'finding add --title',
        'finding add --description-file',
        'finding add --db',
        'finding list --db',
        'finding show --db',
        'finding set-state --db',
        'finding set-severity --db',
        'finding set-title --db',
        'finding set-description --description-file',
        'finding set-description --db',
        'finding update --db',
        'finding post --db',
        'link pending --db',
        'link own --db',
        'link duplicate --db',
        'link note --db',
        'link remove --db',
        'link reply --db',
        'report render --db',
        'report comments --db',
        'report dump --db',
      ]);
      expect(COMMANDS.filter(({ oneOf }) => oneOf).map(({ words, oneOf }) => [words, oneOf])).toEqual([['round open', ['base', 'no-base']]]);
    });

    it('gives an option the same kind (flag or value) wherever it occurs, and every command an example of itself', () => {
      const kinds = new Map<string, boolean>();
      for (const { words, options, example, summary, description } of COMMANDS) {
        for (const { name, value } of options) expect(kinds.get(name) ?? value !== undefined, `${words} --${name}`).toBe(value !== undefined);
        for (const { name, value } of options) kinds.set(name, value !== undefined);
        expect(example.startsWith(`pr-comments ${words}`), words).toBe(true);
        expect(summary, words).not.toBe('');
        expect(description.length, words).toBeGreaterThan(0);
      }
    });

    it('writes the usage line of a command from its table entry', () => {
      expect(synopsis(command('init'))).toBe(
        'pr-comments init <name> [--pr <url>] [--report <file.md>] [--db <file.sqlite>]',
      );
      expect(synopsis(command('round open'))).toBe(
        'pr-comments round open [--revision <rev>] (--base <rev> | --no-base) [--note <text>] --db <file.sqlite>',
      );
      expect(synopsis(command('finding add'))).toBe(
        'pr-comments finding add --severity <high|medium|low> --title <text> --description-file <file|-> [--unverified] [--note <text>] [--json] --db <file.sqlite>',
      );
      expect(synopsis(command('finding set-state'))).toBe(
        'pr-comments finding set-state <finding> <state> [--revision <rev>] [--note <text>] [--round <n>] --db <file.sqlite>',
      );
      expect(synopsis(command('finding post'))).toBe(
        'pr-comments finding post <finding> [--anchor <n>] [--commit <sha>] [--by-agent] [--now] [--dry-run] [--json] --db <file.sqlite>',
      );
      expect(synopsis(command('report comments'))).toBe(
        'pr-comments report comments [--author <login>]... [--ref <ref>]... [--pending] [--out <file.md>] --db <file.sqlite>',
      );
    });

    it('takes the revisions from git in the default environment, and has every member the commands use', () => {
      expect(Object.keys(defaultEnvironment).sort()).toEqual(
        ['cwd', 'getPullRequest', 'now', 'print', 'publish', 'readStdin', 'reply', 'resolveRevision', 'warn'].sort(),
      );
    });
  });

  describe('help', () => {
    const forms = (words: string) => {
      const parts = words.split(' ');
      return [[...parts, '--help'], [...parts, '-h'], ['help', ...parts], ['--help', ...parts]];
    };

    it.each(WORDS)('%s --help, -h and help print its help to standard output and exit with 0', async (words) => {
      const { summary, options, args, example, database } = command(words);
      let first: string | undefined;
      for (const argv of forms(words)) {
        expect(await step(...argv), argv.join(' ')).toBe(0);
        first ??= printed;
        expect(printed, argv.join(' ')).toBe(first);
        expect(warned).toBe('');
      }
      expect(first).toContain(`Usage: ${synopsis(command(words))}\n`);
      expect(first).toContain(summary);
      expect(first).toContain(`Example:\n  ${example}\n`);
      for (const { name, value, description } of options) {
        expect(first).toContain(`--${name}${value ? ` ${value}` : ''}`);
        expect(first).toContain(description);
      }
      for (const { name } of args) expect(first).toContain(name);
      expect(first).toContain({ none: 'creates the database', readonly: 'read-only', change: 'changes the review database' }[database]);
    });

    it('is not held up by a mistake in the rest of the command line, by a missing database or by a bad --db', async () => {
      const before = await tree();
      for (const argv of [
        ['finding', 'list', '--bogus', '--help'],
        ['finding', 'list', '--json=yes', '-h'],
        ['finding', 'show', '--help'],
        ['finding', 'show', 'F1', 'F2', '--help'],
        ['init', '--db', 'report.md', '--help'],
        ['round', 'open', '--base', 'x', '--no-base', '--help'],
        ['link', 'pending', '--db', join(work, 'missing.sqlite'), '--help'],
      ]) {
        expect(await step(...argv), argv.join(' ')).toBe(0);
        expect(printed).toContain('Usage: pr-comments');
      }
      expect(await tree()).toEqual(before);
    });

    it('prints the help of help itself for help help, help --help and help -h, with its usage line, and refuses extra words', async () => {
      const printedBy: string[] = [];
      for (const argv of [['help', 'help'], ['help', '--help'], ['help', '-h'], ['--help', 'help']]) {
        expect(await step(...argv), argv.join(' ')).toBe(0);
        printedBy.push(printed);
        expect(warned).toBe('');
      }
      expect(new Set(printedBy).size).toBe(1);
      expect(printed).toContain('Usage: pr-comments help [<command>]\n');
      expect(printed).toContain('Example:\n  pr-comments help finding set-state\n');
      expect(printed).not.toContain('Options:');
      await expect(step('help', 'help', 'extra')).rejects.toThrow(new Error('unknown command "help extra"\nRun "pr-comments help" for the commands.'));
    });

    it('says the default of init in the words of what it does: a slug of the name', async () => {
      await step('init', '--help');

      expect(printed).toContain('(default: .ai/review-with-docs/<yyyy-mm-dd>_<slug of the name>_review.md at the git root)');
      expect(printed).toContain('the title of the report (a slug of it names the files by default)');
      expect(printed).toContain('--report and --db may both be given only if they agree');
      for (const { words, args, options, summary, description } of COMMANDS) {
        const texts = [summary, ...description, ...args.map(({ description: text }) => text), ...options.map(({ description: text }) => text)];
        expect(texts.some((text) => text.includes('<name>_review')), words).toBe(false);
      }
    });

    it.each([[['--help']], [['-h']], [['help']]])('%j prints the overview: the groups and one line per command, without the options', async (argv) => {
      expect(await step(...argv)).toBe(0);
      expect(warned).toBe('');
      const lines = printed.split('\n');
      for (const group of GROUPS) expect(lines.some((text) => text.startsWith(`${group} (`)), group).toBe(true);
      for (const { words, args, summary } of COMMANDS) {
        const label = [words, ...args.map(({ name, optional }) => (optional ? `[${name}]` : name))].join(' ');
        expect(lines.some((text) => text.startsWith(`  ${label} `) && text.endsWith(`  ${summary}`)), words).toBe(true);
      }
      expect(printed).not.toContain('--severity');
      expect(printed).not.toContain('Example:');
      expect(printed).toContain('Usage: pr-comments <command> [options]');
    });

    it.each(GROUPS)('%s alone, %s --help and help %s print the commands of the group and no others', async (group) => {
      const inGroup = WORDS.filter((words) => words.startsWith(`${group} `));
      const printedBy: string[] = [];
      for (const argv of [[group], [group, '--help'], [group, '-h'], ['help', group]]) {
        expect(await step(...argv), argv.join(' ')).toBe(0);
        printedBy.push(printed);
        expect(warned).toBe('');
      }
      expect(new Set(printedBy).size).toBe(1);
      for (const words of WORDS) expect(printed.includes(`  ${words}`), words).toBe(inGroup.includes(words));
      expect(printed).toContain(`Run "pr-comments ${group} <command> --help"`);
    });

    it('prints the version for --version and -v, without a build id when run from the sources', async () => {
      for (const flag of ['--version', '-v']) {
        expect(await step(flag)).toBe(0);
        expect(printed).toBe(`pr-comments ${VERSION}\n`);
      }
    });

    it('exits with 0 from a real process, with the help on standard output', () => {
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'finding', 'list', '--help'], { encoding: 'utf8', cwd: work });
      expect(result).toMatchObject({ status: 0, stderr: '' });
      expect(result.stdout).toContain(`Usage: ${synopsis(command('finding list'))}`);
    });
  });

  describe('strict arguments', () => {
    // [what is wrong, the arguments, the command whose usage is named, the problem]
    const MISTAKES: [string, string[], string, string][] = [
      ['an unknown option', ['finding', 'list', '--bogus'], 'finding list', 'unknown option --bogus'],
      ['an unknown short option', ['finding', 'list', '-x'], 'finding list', `unknown option -x; ${DASH}`],
      ['an unknown option of a command that creates', ['init', 'Demo', '--bogus'], 'init', 'unknown option --bogus'],
      ['an unknown option given a value', ['finding', 'list', '--bogus=1'], 'finding list', 'unknown option --bogus'],
      ['a text that starts with a dash', ['finding', 'update', 'F1', '-5'], 'finding update', `unknown option -5; ${DASH}`],
      ['a text that is a dash and a word', ['finding', 'update', 'F1', '- item'], 'finding update', `unknown option "- item"; ${DASH}`],
      ['a text that starts with a dash and has several words', ['finding', 'update', 'F1', '-5 is wrong'], 'finding update', `unknown option "-5 is wrong"; ${DASH}`],
      ['a text that starts with a dash and contains h', ['finding', 'update', 'F1', '- see the fix'], 'finding update', `unknown option "- see the fix"; ${DASH}`],
      ['a text that starts with -h and has words', ['finding', 'update', 'F1', '-h is wrong'], 'finding update', `unknown option "-h is wrong"; ${DASH}`],
      ['a text that starts with two dashes', ['finding', 'update', 'F1', '--force'], 'finding update', 'unknown option --force'],
      ['--json on init', ['init', 'Demo', '--json'], 'init', '--json does not apply to init'],
      ['--json on a command that has none to say', ['finding', 'update', 'F1', 'x', '--json'], 'finding update', '--json does not apply to finding update'],
      ['--json on pr connect', ['pr', 'connect', prUrl, '--json'], 'pr connect', '--json does not apply to pr connect'],
      ['--note on a list', ['finding', 'list', '--note', 'x'], 'finding list', '--note does not apply to finding list'],
      ['--state on show', ['finding', 'show', 'F1', '--state', 'approved'], 'finding show', '--state does not apply to finding show'],
      ['--unposted on a change', ['finding', 'set-state', 'F1', 'approved', '--unposted'], 'finding set-state', '--unposted does not apply to finding set-state'],
      ['--revision on update', ['finding', 'update', 'F1', 'x', '--revision', 'HEAD'], 'finding update', '--revision does not apply to finding update'],
      ['--dry-run on a link', ['link', 'own', 'F1', 'r1001', '--dry-run'], 'link own', '--dry-run does not apply to link own'],
      ['--author on report render', ['report', 'render', '--author', 'alice'], 'report render', '--author does not apply to report render'],
      ['--json on report dump', ['report', 'dump', '--json'], 'report dump', '--json does not apply to report dump'],
      ['--out on pending', ['link', 'pending', '--out', 'x.md'], 'link pending', '--out does not apply to link pending'],
      ['--force, which no command has any more', ['report', 'render', '--force'], 'report render', 'unknown option --force'],
      ['--pr-db, which no command has any more', ['pr', 'show', '--pr-db', 'x.sqlite'], 'pr show', 'unknown option --pr-db'],
      ['a repeated option', ['finding', 'list', '--state', 'approved', '--state', 'fixed'], 'finding list', '--state was given more than once'],
      ['a repeated flag', ['finding', 'list', '--json', '--json'], 'finding list', '--json was given more than once'],
      ['a repeated --db', ['pr', 'sync', '--db', 'a.sqlite', '--db', 'b.sqlite'], 'pr sync', '--db was given more than once'],
      ['a repeated --pr', ['init', 'Demo', '--pr', prUrl, '--pr', prUrl], 'init', '--pr was given more than once'],
      ['a missing --severity', ['finding', 'add', '--title', 'T', '--description-file', '-'], 'finding add', '--severity is required'],
      ['a missing --title', ['finding', 'add', '--severity', 'low', '--description-file', '-'], 'finding add', '--title is required'],
      ['a missing --description-file', ['finding', 'add', '--severity', 'low', '--title', 'T'], 'finding add', '--description-file is required'],
      ['a missing --description-file on set-description', ['finding', 'set-description', 'F1'], 'finding set-description', '--description-file is required'],
      ['neither --base nor --no-base', ['round', 'open'], 'round open', '--base <rev> or --no-base is required'],
      ['both --base and --no-base', ['round', 'open', '--base', 'x', '--no-base'], 'round open', '--base and --no-base exclude each other'],
      ['a missing name', ['init'], 'init', 'missing <name>'],
      ['a missing url', ['pr', 'connect'], 'pr connect', 'missing <url>'],
      ['a missing finding', ['finding', 'show'], 'finding show', 'missing <finding>'],
      ['a missing state', ['finding', 'set-state', 'F1'], 'finding set-state', 'missing <state>'],
      ['a missing severity', ['finding', 'set-severity', 'F1'], 'finding set-severity', 'missing <severity>'],
      ['a missing title', ['finding', 'set-title', 'F1'], 'finding set-title', 'missing <title>'],
      ['a missing finding of set-description', ['finding', 'set-description', '--description-file', '-'], 'finding set-description', 'missing <finding>'],
      ['a missing update text', ['finding', 'update', 'F1'], 'finding update', 'missing <text>'],
      ['a missing finding to post', ['finding', 'post'], 'finding post', 'missing <finding>'],
      ['a missing ref', ['link', 'own', 'F1'], 'link own', 'missing <ref>'],
      ['a missing note text', ['link', 'note', 'r1004'], 'link note', 'missing <text>'],
      ['a missing ref to remove', ['link', 'remove'], 'link remove', 'missing <ref>'],
      ['a missing ref to reply to', ['link', 'reply'], 'link reply', 'missing <ref>'],
      ['an extra argument to init', ['init', 'Demo', 'more'], 'init', 'unexpected argument "more"'],
      ['an extra argument to pr show', ['pr', 'show', 'x'], 'pr show', 'unexpected argument "x"'],
      ['an extra argument to pr sync', ['pr', 'sync', prUrl], 'pr sync', `unexpected argument "${prUrl}"`],
      ['an extra argument to round open', ['round', 'open', '--no-base', 'x'], 'round open', 'unexpected argument "x"'],
      ['an extra argument to finding list', ['finding', 'list', 'F1'], 'finding list', 'unexpected argument "F1"'],
      ['an extra argument to finding show', ['finding', 'show', 'F1', 'F2'], 'finding show', 'unexpected argument "F2"'],
      ['an extra argument to link pending', ['link', 'pending', 'r1001'], 'link pending', 'unexpected argument "r1001"'],
      ['an extra argument to link remove', ['link', 'remove', 'r1001', 'r1002'], 'link remove', 'unexpected argument "r1002"'],
      ['an extra argument to report render', ['report', 'render', 'x.md'], 'report render', 'unexpected argument "x.md"'],
      ['an extra argument to report dump', ['report', 'dump', 'x'], 'report dump', 'unexpected argument "x"'],
      ['an option without its value', ['finding', 'list', '--state'], 'finding list', '--state needs a value'],
      ['a round without its value', ['finding', 'update', 'F1', 'x', '--round'], 'finding update', '--round needs a value'],
      [
        'a value that starts with a dash',
        ['pr', 'sync', '--db', '--json'],
        'pr sync',
        '--db needs a value; a value that starts with "-" is written --db=<value>',
      ],
      ['a flag with a value', ['finding', 'list', '--json=yes'], 'finding list', '--json is a flag and takes no value'],
      ['--help with a value', ['finding', 'list', '--help=yes'], 'finding list', '--help is a flag and takes no value'],
    ];

    it.each(MISTAKES)('refuses %s with the problem and the one usage line, and creates nothing', async (_what, argv, words, problem) => {
      const before = await tree();

      await expect(step(...argv)).rejects.toThrow(mistake(words, problem));

      expect(printed).toBe('');
      expect(warned).toBe('');
      expect(await tree()).toEqual(before);
    });

    it('accepts a text that starts with "-" when options such as --db come before --', async () => {
      expect(await run(['round', 'update', '--db', review, '--', '-x note'], env)).toBe(0);
      expect(printed).toBe('Round 1 updated\n');
    });

    it('names no other command in the message of a mistake', async () => {
      const error = await run(['finding', 'list', '--bogus'], env).then(
        () => new Error('it did not fail'),
        (caught: unknown) => caught as Error,
      );
      expect(error.message.split('\n')).toHaveLength(3);
      expect(error.message).not.toContain('finding add');
      expect(error.message).not.toContain('pr-comments init');
    });

    it('takes a text that starts with a dash after --, and a value that starts with a dash after =', async () => {
      await step('finding', 'update', 'F3', '--', '-5 is wrong');
      expect(printed).toBe('F3: note added\n');
      expect((await updatesOf('F3'))?.at(-1)).toBe(`${STAMP} — -5 is wrong`);

      await step('finding', 'set-severity', 'F3', 'high', '--note=-ish');
      expect((await updatesOf('F3'))?.at(-1)).toBe(`${STAMP} — severity ⚪ → 🔴 — -ish`);
    });

    it('allows --author to be repeated, and nothing else', async () => {
      expect(await step('report', 'comments', '--author', 'carol', '--author', 'bob')).toBe(0);
    });

    describe('help', () => {
      const ofHelp = (problem: string) => new Error(`${problem}\nUsage: pr-comments help [<command>]\nRun "pr-comments help --help" for details.`);

      it.each([
        [['help', '--bogus'], 'unknown option --bogus'],
        [['help', 'finding', '--bogus'], 'unknown option --bogus'],
        [['help', '-x'], `unknown option -x; ${DASH}`],
        [['help', '--json'], '--json does not apply to help'],
        [['help', 'finding', 'list', '--state', 'approved'], '--state does not apply to help'],
        [['help', '--db', 'x.sqlite'], '--db does not apply to help'],
        [['help', '--state'], '--state needs a value'],
        [['help', '--json=yes'], '--json is a flag and takes no value'],
        [['help', '--help=yes'], '--help is a flag and takes no value'],
      ])('refuses %j like any other command: the problem, the usage line of help and exit code 1', async (argv, problem) => {
        await expect(step(...argv)).rejects.toThrow(ofHelp(problem));
        expect(printed).toBe('');
      });

      it('refuses options on a group line with the group name and its --help hint', async () => {
        const ofGroup = (problem: string) => new Error(`${problem}\nRun "pr-comments finding --help" for the commands of the group.`);
        await expect(step('finding', '--db', 'x.sqlite')).rejects.toThrow(
          ofGroup('--db does not apply to the finding group; it applies to a command such as "finding list"'),
        );
        await expect(step('finding', '--pr', prUrl)).rejects.toThrow(ofGroup('--pr does not apply to the finding group'));
        await expect(step('finding', '--help=yes')).rejects.toThrow(ofGroup('--help is a flag and takes no value'));
        await expect(step('finding', '-x')).rejects.toThrow(ofGroup('unknown option -x'));
        expect(printed).toBe('');
      });

      it('keeps help --help and help -h valid, and --help wins over what else is wrong', async () => {
        for (const argv of [['help', '--help'], ['help', '-h'], ['help', '--bogus', '--help'], ['help', 'finding', '--json', '-h']]) {
          expect(await step(...argv), argv.join(' ')).toBe(0);
          expect(printed).toContain('Usage: pr-comments help [<command>]\n');
        }
      });

      it('still prints what it was asked for when the options are right', async () => {
        expect(await step('help', 'finding', 'list')).toBe(0);
        expect(printed).toContain(`Usage: ${synopsis(command('finding list'))}`);
        expect(await step('help')).toBe(0);
        expect(printed).toContain('Usage: pr-comments <command> [options]');
      });
    });

    it('takes the options before, between and after the words of the command', async () => {
      await step('--db', review, 'finding', 'list', '--severity', 'low');
      expect(printed).toBe('F3  ⏳ ⚪  Waiting\n1 of 3 findings\n');
      await step('finding', '--json', 'list', '--db', review, '--state', 'awaiting');
      expect(JSON.parse(printed)).toMatchObject([{ id: 'F3' }]);
    });

    it('answers an unknown command with its name and the way to the commands', async () => {
      await expect(step('frobnicate')).rejects.toThrow(new Error('unknown command "frobnicate"\nRun "pr-comments help" for the commands.'));
      await expect(step('frobnicate', prUrl, '--db', review)).rejects.toThrow(
        new Error('unknown command "frobnicate"\nRun "pr-comments help" for the commands.'),
      );
      await expect(step('help', 'frobnicate')).rejects.toThrow('unknown command "frobnicate"');
      await expect(step('help', 'finding', 'frobnicate')).rejects.toThrow(
        new Error('unknown command "finding frobnicate"\nRun "pr-comments finding --help" for the commands of the group.'),
      );
      await expect(step('help', 'finding', 'list', 'extra')).rejects.toThrow('unknown command "finding list extra"');
      expect(printed).toBe('');
    });

    // The commands that were: each is an unknown command now, with no alias and no usage dump.
    it.each([
      [['sync', prUrl], 'sync', undefined],
      [['render', prUrl], 'render', undefined],
      [['post', prUrl, 'F1.md'], 'post', undefined],
      [['threads'], 'threads', undefined],
      [['verify'], 'verify', undefined],
      [['status', 'close', '--revision', 'HEAD'], 'status', undefined],
      [['new-id'], 'new-id', undefined],
      [['report', 'check'], 'report check', 'report'],
      [['report', 'verify'], 'report verify', 'report'],
      [['report', 'list'], 'report list', 'report'],
      [['report', 'show', 'F1'], 'report show', 'report'],
      [['report', 'post', 'F1'], 'report post', 'report'],
      [['report', 'reply', 'r1001'], 'report reply', 'report'],
      [['report', 'link', 'own'], 'report link', 'report'],
      [['report', 'threads'], 'report threads', 'report'],
      [['report', 'pr'], 'report pr', 'report'],
      [['report', 'init', 'Demo'], 'report init', 'report'],
      [['report', 'import', 'a.md'], 'report import', 'report'],
      [['import', 'a.md'], 'import', undefined],
      [['finding', 'retitle', 'F1', 'x'], 'finding retitle', 'finding'],
      [['finding', 'note', 'F1', 'x'], 'finding note', 'finding'],
      [['commit', 'record', 'abc1234'], 'commit', undefined],
      [['rule', 'add', 'a rule'], 'rule', undefined],
      [['commit', 'add', 'HEAD', '--note', 'the Round 1 report'], 'commit', undefined],
    ])('answers the old command %j as unknown', async (argv, text, group) => {
      const hint = group === undefined ? 'Run "pr-comments help" for the commands.' : `Run "pr-comments ${group} --help" for the commands of the group.`;
      await expect(step(...argv, '--db', review)).rejects.toThrow(new Error(`unknown command "${text}"\n${hint}`));
      expect(printed).toBe('');
    });

    it('answers no command with the short usage, and an option alone as unknown', async () => {
      await expect(step()).rejects.toThrow(new Error('Usage: pr-comments <command> [options]\nRun "pr-comments help" for the commands.'));
      await expect(step('--db', 'x.sqlite')).rejects.toThrow(
        new Error('Usage: pr-comments <command> [options]\nRun "pr-comments help" for the commands.'),
      );
      await expect(step('--help=yes')).rejects.toThrow(new Error('--help is a flag and takes no value\nRun "pr-comments help" for the commands.'));
      await expect(step('--bogus')).rejects.toThrow(new Error('unknown option --bogus\nRun "pr-comments help" for the commands.'));
      await expect(step('-x')).rejects.toThrow(new Error('unknown option -x\nRun "pr-comments help" for the commands.'));
      await expect(step('--version', 'x')).rejects.toThrow('unknown option --version');
      await expect(step('pr', 'show', '--version')).rejects.toThrow(mistake('pr show', 'unknown option --version'));
    });

    it('exits with 1 from a real process, with the message on standard error and nothing on standard output', () => {
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'finding', 'list', '--bogus'], { encoding: 'utf8', cwd: work });
      expect(result).toMatchObject({ status: 1, stdout: '', stderr: `${mistake('finding list', 'unknown option --bogus').message}\n` });
    });

    it.each([
      [['rule', 'add', 'a rule'], 'rule'],
      [['commit', 'add'], 'commit'],
    ])('exits with 1 from a real process for the removed command %j, naming it', (argv, name) => {
      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...argv], { encoding: 'utf8', cwd: work });
      expect(result).toMatchObject({ status: 1, stdout: '', stderr: `unknown command "${name}"\nRun "pr-comments help" for the commands.\n` });
    });

    it('exits with 1 from a real process for import, which is no command any more, and creates nothing', async () => {
      const report = join(docs, 'old_review.md');
      await writeFile(report, '# Review\n', 'utf8');
      const before = await tree();

      const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, 'import', report], { encoding: 'utf8', cwd: work });

      expect(result).toMatchObject({ status: 1, stdout: '', stderr: 'unknown command "import"\nRun "pr-comments help" for the commands.\n' });
      expect(await tree()).toEqual(before);
    });
  });

  describe('the database', () => {
    describe('--db', () => {
      it.each(WORDS)('refuses a file for %s that does not end in .sqlite, and creates nothing', async (words) => {
        const before = await tree();
        for (const name of ['report.md', 'report.txt', 'review']) {
          await expect(step(...valid(words), '--db', name), name).rejects.toThrow(`--db must be a file ending in .sqlite: ${name}`);
        }
        expect(printed).toBe('');
        expect(warned).toBe('');
        expect(await tree()).toEqual(before);
      });

      it('accepts the extension in any case', async () => {
        const named = join(docs, 'Other.SQLITE');
        expect(await step('init', 'Other', '--db', named)).toBe(0);
        expect(await exists(named)).toBe(true);
      });
    });

    describe('a database that does not exist', () => {
      it.each(DATABASE_COMMANDS)('is an error for %s, and is never created', async (words) => {
        const missing = join(docs, 'missing_review.sqlite');
        const before = await tree();

        await expect(step(...valid(words), '--db', missing)).rejects.toThrow(`${missing} does not exist`);

        expect(printed).toBe('');
        expect(warned).toBe('');
        expect(await exists(missing)).toBe(false);
        expect(await tree()).toEqual(before);
      });
    });

    describe('without --db', () => {
      it.each(DATABASE_COMMANDS)('requires --db for %s, and changes nothing', async (words) => {
        const before = await bytes();
        const listing = await tree();
        printed = '';
        warned = '';

        await expect(run(valid(words), env)).rejects.toThrow(mistake(words, '--db is required'));

        expect(printed).toBe('');
        expect(warned).toBe('');
        expect((await bytes()).equals(before)).toBe(true);
        expect(await tree()).toEqual(listing);
      });

      it('is not asked for by init, which creates a database in .ai/review-with-docs/', async () => {
        const repo = join(work, 'repo');
        await mkdir(join(repo, '.git', 'refs'), { recursive: true });
        await mkdir(join(repo, '.git', 'objects'), { recursive: true });
        await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
        env.cwd = () => repo;

        expect(await run(['init', 'PR 44'], env)).toBe(0);

        expect(await exists(join(repo, '.ai', 'review-with-docs', '2026-10-09_pr-44_review.sqlite'))).toBe(true);
        expect(warned).toBe('');
      });
    });

    describe('the commands that read', () => {
      it.each(READONLY)('%s leaves the database byte for byte as it was, and names no database', async (words) => {
        const before = await bytes();
        const listing = await tree(docs);

        expect(await step(...valid(words), '--db', review)).toBe(0);

        expect((await bytes()).equals(before)).toBe(true);
        // Only the report of `report render` is new next to it: no journal, no copy.
        expect(await tree(docs)).toEqual(words === 'report render' ? [...listing, 'demo_review.md'].sort() : listing);
        expect(warned).toBe('');
      });

      it('work on a database that cannot be written at all', async () => {
        await chmod(review, 0o444);
        try {
          for (const words of READONLY.filter((name) => name !== 'report render')) {
            expect(await step(...valid(words), '--db', review), words).toBe(0);
          }
          expect(await step('report', 'render', '--db', review, '--out', join(work, 'out.md'))).toBe(0);
        } finally {
          await chmod(review, 0o666);
        }
      });

      it('do not create a database for a file that is none: they refuse it', async () => {
        const junk = join(docs, 'junk.sqlite');
        await writeFile(junk, 'not a database', 'utf8');

        for (const words of READONLY) {
          await expect(step(...valid(words), '--db', junk), words).rejects.toThrow();
        }

        expect(await readFile(junk, 'utf8')).toBe('not a database');
        expect(await tree(docs)).toEqual(['demo_review.sqlite', 'junk.sqlite']);
      });
    });

    describe('the review database line', () => {
      // Every command that changes the database, in an order in which each one can work, and what it prints.
      const CHANGES: [string[], string][] = [
        [['pr', 'connect', 'https://ghe.example.com/acme/widgets/pull/158'], 'Connected to https://ghe.example.com/acme/widgets/pull/158\n'],
        [['pr', 'connect', prUrl], `Connected to ${prUrl}\n`],
        [['pr', 'sync'], 'Synced acme/widgets#157: 2 reviews, 2 threads, 5 comments, 4 annotations\n'],
        [['round', 'open', '--revision', 'HEAD', '--base', 'origin/main'], 'Round 2 opened\n'],
        [['round', 'update', 'no findings'], 'Round 2 updated\n'],
        [['finding', 'add', '--severity', 'low', '--title', 'Four', '--description-file', '-'], 'Added F4\n'],
        [['finding', 'add', '--severity', 'low', '--title', 'Five', '--description-file', '-', '--json'], '{\n  "id": "F5"\n}\n'],
        [['finding', 'set-state', 'F3', 'approved'], 'F3: ⏳ → ✅\n'],
        [['finding', 'set-severity', 'F3', 'high'], 'F3: ⚪ → 🔴\n'],
        [['finding', 'set-title', 'F3', 'Other'], 'F3: retitled\n'],
        [['finding', 'set-description', 'F3', '--description-file', '-'], 'F3: description replaced\n'],
        [['finding', 'update', 'F3', 'a note'], 'F3: note added\n'],
        [['link', 'own', 'F3', 'r1001'], 'F3: own comment r1001 linked\n'],
        [['link', 'duplicate', 'F3', 'r1002'], 'F3: duplicate r1002 linked\n'],
        [['link', 'note', 'r1004', 'a bot'], 'r1004: noted\n'],
        [['link', 'remove', 'r1004'], 'r1004 unlinked\n'],
      ];

      it('follows every command that changes the database, on stderr, and leaves the output as it was', async () => {
        // `finding post` and `link reply` have their own tests, with the fakes they need.
        const covered = new Set(CHANGES.map(([argv]) => argv.slice(0, 2).join(' ')));
        expect([...covered].sort()).toEqual(CHANGING.filter((words) => !['finding post', 'link reply'].includes(words)).sort());
        for (const [argv, output] of CHANGES) {
          expect(await step(...argv, '--db', review), argv.join(' ')).toBe(0);
          expect(printed, argv.join(' ')).toBe(output);
          expect(warned, argv.join(' ')).toBe(line());
        }
      });

      it('does not follow a command that ran but changed nothing: connecting to the pull request it is connected to already', async () => {
        const before = await bytes();

        for (const url of [prUrl, `${prUrl}/`, 'https://GHE.example.com/Acme/Widgets/pull/157']) {
          expect(await step('pr', 'connect', url, '--db', review), url).toBe(0);
          expect(printed, url).toBe(`Already connected to ${prUrl}\n`);
          expect(warned, url).toBe('');
        }
        expect((await bytes()).equals(before)).toBe(true);
      });

      it('follows no command that only reads, and none that failed, and the database stays as it was', async () => {
        const before = await bytes();
        for (const words of READONLY) {
          expect(await step(...valid(words), '--db', review), words).toBe(0);
          expect(warned, words).toBe('');
        }
        for (const argv of [
          ['finding', 'update', 'F3', ' '],
          ['finding', 'set-state', 'F9', 'approved'],
          ['finding', 'set-state', 'F3', 'nonsense'],
          ['round', 'open', '--revision', 'nope', '--no-base'],
          ['pr', 'connect', 'nonsense'],
          ['link', 'remove', 'r1001'],
          ['link', 'own', 'F1', 'r999'],
          ['pr', 'sync', 'extra'],
        ]) {
          await expect(step(...argv, '--db', review), argv.join(' ')).rejects.toThrow();
          expect(warned, argv.join(' ')).toBe('');
        }
        expect((await bytes()).equals(before)).toBe(true);
      });

      it('shows the path as given when it was typed relative, relative to the working directory when it is below it, and absolute otherwise', async () => {
        await step('finding', 'update', '--db', review, 'F3', 'one');
        expect(warned).toBe(`Review database: ${join('docs', 'demo_review.sqlite')}\n`);

        const typed = relative(process.cwd(), review);
        await step('finding', 'update', '--db', typed, 'F3', 'two');
        expect(warned).toBe(`Review database: ${typed}\n`);

        env.cwd = () => join(docs, 'deeper');
        await step('finding', 'update', '--db', review, 'F3', 'three');
        expect(warned).toBe(`Review database: ${review}\n`);
      });

      it.each([
        ['finding update', ['finding', 'update', 'F3', 'saved'], async () => undefined],
        ['link duplicate', ['link', 'duplicate', 'F1', 'r1002'], async () => undefined],
        [
          'finding post',
          ['finding', 'post', 'F1'],
          async () => {
            env.publish = async (_ref, _comment, _options, hooks) =>
              hooks.onResult!({
                action: 'created',
                dryRun: false,
                comment: 'r2001',
                url: `${prUrl}#discussion_r2001`,
                state: 'pending',
                path: 'src/app.ts',
                lines: '10-12',
              });
            env.getPullRequest = async () => withComments('r2001');
          },
        ],
        [
          'link reply',
          ['link', 'reply', 'r1002'],
          async () => {
            await step('link', 'own', '--db', review, 'F1', 'r1001');
            await step('link', 'duplicate', '--db', review, 'F1', 'r1002');
            env.reply = async () => ({
              action: 'created',
              dryRun: false,
              state: 'pending',
              comment: 'r546201',
              url: `${prUrl}#discussion_r546201`,
            });
            env.getPullRequest = async () => withComments('r546201');
          },
        ],
      ])('warns on stderr when %s commits a change that cannot refresh the report file', async (_name, argv, setup) => {
        await setup();
        const reportPath = reviewPaths(review).report;
        await step('report', 'render', '--db', review);
        await chmod(reportPath, 0o444);
        try {
          expect(await step(...argv, '--db', review)).toBe(0);
          expect(warned).toMatch(
            /^Warning: the report .*demo_review\.md was not refreshed \(.*\); run "pr-comments report render --db .*demo_review\.sqlite"\nReview database: /u,
          );
        } finally {
          await chmod(reportPath, 0o666);
        }
      });
    });
  });

  describe('init', () => {
    const created = (path: string) => `Created ${shown(path)}\nReport: ${shown(reviewPaths(path).report)}\n`;

    it('creates the database and report, next to the report or where --db says, and names no database on stderr', async () => {
      const report = join(docs, 'chain_review.md');

      expect(await step('init', 'PR 42', '--report', report)).toBe(0);

      expect(printed).toBe(created(join(docs, 'chain_review.sqlite')));
      expect(warned).toBe('');
      expect(await tree(docs)).toEqual(['chain_review.md', 'chain_review.sqlite', 'demo_review.sqlite']);
      expect((await loadReviewFile(join(docs, 'chain_review.sqlite'))).data).toMatchObject({ target: 'PR 42', findings: [] });

      const named = join(docs, 'named.sqlite');
      await step('init', 'PR 43', '--db', named);
      expect(printed).toBe(created(named));
      expect((await loadReviewFile(named)).data.target).toBe('PR 43');
    });

    it('warns on stderr and keeps the created database when the initial report file cannot be written', async () => {
      const readonlyDb = join(docs, 'readonly_review.sqlite');
      vi.mocked(writeFile).mockRejectedValueOnce(new Error('EPERM: report locked'));

      expect(await step('init', 'PR 42', '--db', readonlyDb)).toBe(0);
      expect(printed).toBe(`Created ${shown(readonlyDb)}\n`);
      expect(warned).toMatch(
        /^Warning: the report .*readonly_review\.md was not refreshed \(EPERM: report locked\); run "pr-comments report render --db .*readonly_review\.sqlite"\n$/u,
      );
      expect((await loadReviewFile(readonlyDb)).data.target).toBe('PR 42');
    });

    it('normalizes an upper-case --report .MD extension to .md so init and later mutations write the same report file', async () => {
      const upperReport = join(docs, 'upper_review.MD');
      const lowerReport = join(docs, 'upper_review.md');
      const upperDb = join(docs, 'upper_review.sqlite');

      expect(await step('init', 'PR 42', '--report', upperReport)).toBe(0);
      expect(printed).toBe(`Created ${shown(upperDb)}\nReport: ${shown(lowerReport)}\n`);

      expect(await step('round', 'open', '--no-base', '--note', 'updated round', '--db', upperDb)).toBe(0);
      expect(await readFile(lowerReport, 'utf8')).toContain('updated round');
    });

    it('refuses an existing report file without overwriting it or creating a database', async () => {
      const existingMd = join(docs, 'notes_review.md');
      await writeFile(existingMd, 'my important notes\n', 'utf8');

      await expect(step('init', 'PR 42', '--report', existingMd)).rejects.toThrow(
        `${existingMd} already exists; init will not overwrite an existing report file`,
      );
      expect(await readFile(existingMd, 'utf8')).toBe('my important notes\n');
      expect(await exists(join(docs, 'notes_review.sqlite'))).toBe(false);
    });

    it('takes the database for --report as well as the report', async () => {
      const named = join(docs, 'chain_review.sqlite');

      await step('init', 'PR 42', '--report', named);

      expect(printed.split('\n')[0]).toBe(`Created ${shown(named)}`);
      expect((await loadReviewFile(named)).data.target).toBe('PR 42');
      await expect(step('init', 'PR 42', '--report', join(docs, 'other.txt'))).rejects.toThrow('must be a report (.md) or a review database (.sqlite)');
    });

    it('connects the review to the pull request with --pr and prints the canonical URL', async () => {
      const named = join(docs, 'chain_review.sqlite');

      expect(await step('init', 'PR 42', '--db', named, '--pr', `${prUrl}/`)).toBe(0);

      expect(printed).toBe(`Created ${shown(named)}\nPull request: ${prUrl}\nReport: ${shown(reviewPaths(named).report)}\n`);
      expect((await loadReviewFile(named)).pullRequest).toBe(prUrl);
    });

    it('creates .ai/review-with-docs/<yyyy-mm-dd>_<slug>_review.sqlite at the git root without --report, shown relative to the working directory', async () => {
      const repo = join(work, 'repo');
      await mkdir(join(repo, '.git', 'refs'), { recursive: true });
      await mkdir(join(repo, '.git', 'objects'), { recursive: true });
      await writeFile(join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
      env.cwd = () => repo;

      expect(await step('init', 'PR 42 — tenant registry')).toBe(0);

      const db = join(repo, '.ai', 'review-with-docs', '2026-10-09_pr-42-tenant-registry_review.sqlite');
      const below = relative(repo, db);
      const belowReport = relative(repo, reviewPaths(db).report);
      expect(printed).toBe(`Created ${below}\nReport: ${belowReport}\n`);
      expect(await exists(db)).toBe(true);
    });

    it('refuses --report and --db that name different files, and accepts them when they agree', async () => {
      const before = await tree(docs);
      const different = (report: string, db: string) =>
        new Error(`--report ${report} and --db ${db} name different files; the report is always next to the database with the same name`);

      for (const [report, db] of [
        [join(docs, 'a.md'), join(docs, 'b.sqlite')],
        [join(docs, 'other', 'b.md'), join(docs, 'b.sqlite')],
        [join(docs, 'b.sqlite'), join(docs, 'c.sqlite')],
      ] as const) {
        await expect(step('init', 'X', '--report', report, '--db', db)).rejects.toThrow(different(report, db));
        await expect(step('init', 'X', '--db', db, '--report', report)).rejects.toThrow(different(report, db));
      }
      expect(printed).toBe('');
      expect(await tree(docs)).toEqual(before);

      await step('init', 'X', '--report', join(docs, 'c.md'), '--db', join(docs, 'c.sqlite'));
      await step('init', 'X', '--report', join(docs, 'd.sqlite'), '--db', join(docs, 'd.sqlite'));
      await step('init', 'X', '--report', `${docs}/./e.md`, '--db', join(docs, 'e.sqlite'));
      await step('init', 'X', '--report', relative(process.cwd(), join(docs, 'f.md')), '--db', join(docs, 'f.sqlite'));
      expect(await tree(docs)).toEqual([...before, 'c.md', 'c.sqlite', 'd.md', 'd.sqlite', 'e.md', 'e.sqlite', 'f.md', 'f.sqlite'].sort());
    });

    it('compares the names the way the paths are derived: without regard to case where the file system has none', async () => {
      const argv = ['init', 'X', '--report', join(docs, 'G.MD'), '--db', join(docs, 'g.sqlite')];
      if (process.platform === 'win32') {
        expect(await step(...argv)).toBe(0);
        expect(await exists(join(docs, 'g.sqlite'))).toBe(true);
      } else {
        await expect(step(...argv)).rejects.toThrow('name different files');
      }
    });

    it('refuses an existing database and leaves it alone, a blank name, and a pull request URL that is none', async () => {
      const before = await bytes();

      await expect(step('init', 'PR 43', '--db', review)).rejects.toThrow(/demo_review\.sqlite already exists; the database is the source of truth/u);
      expect((await bytes()).equals(before)).toBe(true);

      await expect(step('init', '  ', '--db', join(docs, 'blank.sqlite'))).rejects.toThrow('the name must not be empty');
      await expect(step('init', 'PR 44', '--db', join(docs, 'bad.sqlite'), '--pr', 'not a url')).rejects.toThrow('Not a valid URL: not a url');
      await expect(step('init', 'PR 44', '--db', join(docs, 'bad.sqlite'), '--pr', 'https://ghe.example.com/acme/widgets/issues/157')).rejects.toThrow(
        'Not a pull request URL',
      );
      expect(await tree(docs)).toEqual(['demo_review.sqlite']);
      expect(printed).toBe('');
    });
  });

  describe('pr', () => {
    const OTHER = 'https://ghe.example.com/acme/widgets/pull/158';
    // A review that is connected to no pull request.
    const bare = async () => {
      const db = join(docs, 'bare_review.sqlite');
      await step('init', 'Bare', '--db', db);
      return db;
    };

    describe('connect', () => {
      it('connects the review and prints the canonical URL, and names the database', async () => {
        const db = await bare();

        expect(await step('pr', 'connect', `${prUrl}/`, '--db', db)).toBe(0);

        expect(printed).toBe(`Connected to ${prUrl}\n`);
        expect(warned).toBe(line(db));
        expect((await loadReviewFile(db)).pullRequest).toBe(prUrl);
      });

      it('says it is connected already, and changes nothing, for the same pull request in any spelling', async () => {
        const before = await bytes();

        await step('pr', 'connect', prUrl);
        expect(printed).toBe(`Already connected to ${prUrl}\n`);
        expect(warned).toBe('');
        await step('pr', 'connect', `${prUrl}/`, '--db', review);
        expect(printed).toBe(`Already connected to ${prUrl}\n`);
        expect(warned).toBe('');
        await step('pr', 'connect', 'https://GHE.example.com/Acme/Widgets/pull/157', '--db', review);
        expect(printed).toBe(`Already connected to ${prUrl}\n`);
        expect(warned).toBe('');

        expect((await bytes()).equals(before)).toBe(true);
      });

      it('moves the connection to another pull request while the review has no links, and refuses it once it has', async () => {
        await step('pr', 'connect', OTHER, '--db', review);
        expect(printed).toBe(`Connected to ${OTHER}\n`);
        expect(await loadSnapshot(review)).toBeUndefined();

        await step('pr', 'connect', prUrl, '--db', review);
        await step('pr', 'sync', '--db', review);
        await step('link', 'note', 'r1004', 'a bot', '--db', review);
        await fails(['pr', 'connect', OTHER, '--db', review], /connected to .* point there; remove them first with/u);
        expect((await loaded()).pullRequest).toBe(prUrl);
      });

      it('refuses a URL that is not a pull request, and changes nothing', async () => {
        await fails(['pr', 'connect', 'https://ghe.example.com/acme/widgets', '--db', review], 'Not a pull request URL');
        await fails(['pr', 'connect', 'nonsense', '--db', review], 'Not a valid URL: nonsense');
      });
    });

    describe('show', () => {
      it('says the review is not connected, and how to connect it, on standard output with exit 0', async () => {
        const db = await bare();
        const before = await readFile(db);

        expect(await step('pr', 'show', '--db', db)).toBe(0);

        expect(printed).toBe(`not connected to a pull request; connect it with "pr-comments pr connect --db ${db} <url>"\n`);
        expect(warned).toBe('');
        await step('pr', 'show', '--db', db, '--json');
        expect(JSON.parse(printed)).toEqual({ pullRequest: null });
        expect((await readFile(db)).equals(before)).toBe(true);
      });

      it('says the pull request is not synced yet, and how to sync it', async () => {
        const db = await bare();
        await step('pr', 'connect', prUrl, '--db', db);

        expect(await step('pr', 'show', '--db', db)).toBe(0);
        expect(printed).toBe(`${prUrl}\nnot synced yet; run "pr-comments pr sync --db ${db}"\n`);
        await step('pr', 'show', '--db', db, '--json');
        expect(JSON.parse(printed)).toEqual({ pullRequest: prUrl, synced: false });
      });

      it('quotes a database path with spaces in command hints', async () => {
        const spacedDir = join(work, 'my reviews');
        await mkdir(spacedDir, { recursive: true });
        const db = join(spacedDir, 'spaced_review.sqlite');
        await step('init', 'Spaced', '--db', db);

        expect(await step('pr', 'show', '--db', db)).toBe(0);
        expect(printed).toBe(`not connected to a pull request; connect it with "pr-comments pr connect --db '${db}' <url>"\n`);
        await expect(step('pr', 'sync', '--db', db)).rejects.toThrow(
          `the review is not connected to a pull request; connect it first with "pr-comments pr connect --db '${db}' <url>"`,
        );
      });

      it('prints the pull request, when it was synced, its head and what the database holds of it', async () => {
        expect(await step('pr', 'show')).toBe(0);
        expect(printed).toBe(`${prUrl}\nsynced 2026-01-06T12:00:00Z, head cccccccc\n2 reviews, 2 threads, 5 comments, 4 annotations\n`);

        await step('pr', 'show', '--json');
        expect(JSON.parse(printed)).toEqual({
          pullRequest: prUrl,
          synced: true,
          fetchedAt: '2026-01-06T12:00:00Z',
          headSha: 'c'.repeat(40),
          reviews: 2,
          threads: 2,
          comments: 5,
          annotations: 4,
        });
        expect(warned).toBe('');
      });
    });

    describe('sync', () => {
      it('downloads the connected pull request, stores it and says how much, and names the database', async () => {
        snapshot = samplePullRequest();

        expect(await step('pr', 'sync')).toBe(0);

        expect(printed).toBe('Synced acme/widgets#157: 2 reviews, 2 threads, 5 comments, 0 annotations\n');
        expect(warned).toBe(line());
        expect(downloads).toEqual([PR_REF]);
        expect(await loadSnapshot(review)).toMatchObject(samplePullRequest());
      });

      it('counts the annotations over all check runs, and keeps the check runs', async () => {
        await step('pr', 'sync');

        expect(printed).toBe('Synced acme/widgets#157: 2 reviews, 2 threads, 5 comments, 4 annotations\n');
        expect((await loadSnapshot(review))?.checkRuns).toEqual(checkRuns());
      });

      it('replaces what the last sync stored: an edited comment, a new one, a deleted one', async () => {
        snapshot = withChecks();
        snapshot.comments = snapshot.comments.filter(({ id }) => id !== 'rc-2');
        snapshot.comments.find(({ id }) => id === 'rc-1')!.body = 'Rewritten after discussion';

        await step('pr', 'sync');

        expect(printed).toContain('2 reviews, 2 threads, 4 comments');
        expect((await loadSnapshot(review))?.comments.map(({ body }) => body)).toContain('Rewritten after discussion');
      });

      it('needs a connected pull request, and the one it downloaded must be the connected one', async () => {
        const db = join(docs, 'bare_review.sqlite');
        await step('init', 'Bare', '--db', db);
        await expect(step('pr', 'sync', '--db', db)).rejects.toThrow(
          `the review is not connected to a pull request; connect it first with "pr-comments pr connect --db ${db} <url>"`,
        );
        expect(downloads).toEqual([]);

        snapshot = { ...samplePullRequest(), pullRequest: { ...samplePullRequest().pullRequest, number: 158 } };
        await fails(['pr', 'sync', '--db', review], /connected to .*157, not to .*158/u);
      });

      it('changes nothing when the download fails', async () => {
        env.getPullRequest = async () => {
          throw new Error('GitHub says no');
        };

        await fails(['pr', 'sync', '--db', review], 'GitHub says no');
      });
    });
  });

  describe('round open', () => {
    it('opens round 2, 3, … from HEAD, resolves what git names, and stores the hashes, never the words', async () => {
      expect(await step('round', 'open', '--base', 'origin/main')).toBe(0);
      expect(printed).toBe('Round 2 opened\n');
      expect(warned).toBe(line());
      expect(revisions).toEqual(['HEAD', 'origin/main']);

      await step('round', 'open', '--revision', 'feature', '--no-base', '--note', 'scope: src/ only');
      expect(printed).toBe('Round 3 opened\n');
      expect((await loaded()).data.intro.reviewed.items).toMatchObject([
        { round: 1, revision: '1a2b3c4d', base: null },
        { round: 2, revision: '1a2b3c4d', base: '5e6f7a8b' },
        { round: 3, revision: '9c0d1e2f', base: null },
      ]);
      expect((await loaded()).data.intro.reviewed.items.at(-1)?.text).toBe('Round 3 — `9c0d1e2f`, base none — reviewed as it stands; scope: src/ only');
    });

    it('says in its help that the note is where the scope of the review is written', async () => {
      await step('round', 'open', '--help');

      expect(printed).toContain('where the scope or other context of the review can be written');
    });

    it('fails on a revision that git does not know, before it changes anything', async () => {
      await fails(['round', 'open', '--revision', 'nope', '--no-base', '--db', review], 'revision "nope" does not exist in this repository');
      await fails(['round', 'open', '--base', 'nope', '--db', review], 'revision "nope" does not exist in this repository');
      await fails(['round', 'open', '--revision', ' ', '--no-base', '--db', review], '--revision must not be empty');
      await fails(['round', 'open', '--base', ' ', '--db', review], '--base must not be empty');
      await fails(['round', 'open', '--no-base', '--note', ' ', '--db', review], '--note must not be empty');
      expect((await loaded()).data.intro.reviewed.items).toHaveLength(1);
    });

    it('updates the latest or a named round, and refuses invalid rounds or empty text', async () => {
      await step('round', 'open', '--no-base', '--db', review);
      expect(await step('round', 'update', 'no new findings', '--db', review)).toBe(0);
      expect(printed).toBe('Round 2 updated\n');
      expect((await loaded()).data.intro.reviewed.items[1]?.text).toContain('; no new findings');

      expect(await step('round', 'update', '11 fixed', '--round', '1', '--db', review)).toBe(0);
      expect(printed).toBe('Round 1 updated\n');
      expect((await loaded()).data.intro.reviewed.items[0]?.text).toContain('; 11 fixed');

      await fails(['round', 'update', ' ', '--db', review], 'the text must not be empty');
      await fails(['round', 'update', 'note', '--round', '9', '--db', review], 'round 9 was never opened; the latest round is 2');
      await fails(['round', 'update', 'note', '--round', '0', '--db', review], '--round must be a positive whole number');
    });

    describe('with a real git repository', () => {
      let repo: string;
      let first: string;
      let second: string;
      const git = (...args: string[]) =>
        execFileAsync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: repo });
      const hashOf = async (revision: string) => (await git('rev-parse', '--short=8', revision)).stdout.trim();

      beforeEach(async () => {
        repo = join(work, 'repo');
        await mkdir(repo);
        await git('init', '-q');
        await git('commit', '--allow-empty', '-q', '-m', 'first');
        first = await hashOf('HEAD');
        await git('tag', 'v1');
        await git('commit', '--allow-empty', '-q', '-m', 'second');
        second = await hashOf('HEAD');
        env.resolveRevision = (revision) => resolveRevision(revision, repo);
      });

      it('stores the 8-character hash of HEAD, of a tag, of an abbreviation and of an expression', async () => {
        expect(first).not.toBe(second);

        await step('round', 'open', '--revision', 'HEAD', '--base', 'v1', '--db', review);
        await step('round', 'open', '--revision', second.slice(0, 7), '--base', 'HEAD~1', '--db', review);

        expect((await loaded()).data.intro.reviewed.items).toMatchObject([
          { round: 1 },
          { round: 2, revision: second, base: first },
          { round: 3, revision: second, base: first },
        ]);
      });

      it('fails on a revision the repository does not have, and changes nothing', async () => {
        await fails(['round', 'open', '--revision', 'nope', '--no-base', '--db', review], 'revision "nope" does not exist in this repository');
        await fails(['round', 'open', '--revision', 'deadbeef', '--no-base', '--db', review], 'revision "deadbeef" does not exist in this repository');
      });
    });
  });

  describe('finding add', () => {
    const add = (...options: string[]) => ['finding', 'add', '--db', review, '--severity', 'high', '--title', 'T', ...options];
    const textFile = async (name: string, text: string | Uint8Array) => {
      const path = join(work, name);
      await writeFile(path, text);
      return path;
    };

    it('needs an open round', async () => {
      const db = join(docs, 'bare_review.sqlite');
      await step('init', 'Bare', '--db', db);

      await expect(step('finding', 'add', '--db', db, '--severity', 'high', '--title', 'T', '--description-file', '-')).rejects.toThrow(
        'no round is open yet',
      );
    });

    it('takes the description from a file or from standard input, without BOM, CRLF and surrounding blank lines', async () => {
      const file = await textFile('d.md', '\uFEFF\r\n\r\n  indented first line\r\nsecond\r\n\r\n');
      await step(...add('--description-file', file));
      expect(printed).toBe('Added F4\n');
      expect(warned).toBe(line());
      stdin = '\n\nFrom stdin.\n\n';
      await step('finding', 'add', '--db', review, '--severity', 'Medium', '--title', 'From stdin', '--description-file', '-');

      expect((await findingOf('F4'))?.description).toBe('  indented first line\nsecond');
      expect((await findingOf('F5'))?.description).toBe('From stdin.');
      expect((await findingOf('F5'))?.severity).toBe('🟡');
    });

    it('opens at ⏳ awaiting triage, or at ❓ with --unverified, and notes the opening in the latest round', async () => {
      await step(...add('--description-file', '-'));
      await step(...add('--description-file', '-', '--unverified', '--note', 'seen in a log'));

      expect((await findingOf('F4'))?.state).toBe('⏳');
      expect((await findingOf('F5'))?.state).toBe('❓');
      expect(await updatesOf('F4')).toEqual([`${STAMP} — Round 1: raised ⏳`]);
      expect(await updatesOf('F5')).toEqual([`${STAMP} — Round 1: raised ❓ — seen in a log`]);
    });

    it('prints only the id as JSON with --json', async () => {
      expect(await step(...add('--description-file', '-', '--json'))).toBe(0);

      expect(printed).toBe('{\n  "id": "F4"\n}\n');
      expect(warned).toBe(line());
    });

    it('refuses a severity that is none, an empty title or description, and a file that is not there, and changes nothing', async () => {
      await fails(['finding', 'add', '--db', review, '--severity', 'critical', '--title', 'T', '--description-file', '-'], '"critical" is not a severity; use one of: high, medium, low');
      await fails(['finding', 'add', '--db', review, '--severity', '🔴', '--title', 'T', '--description-file', '-'], '"🔴" is not a severity');
      await fails(['finding', 'add', '--db', review, '--severity', 'high', '--title', ' ', '--description-file', '-'], '--title must not be empty');
      stdin = ' \r\n\t\n';
      await fails(add('--description-file', '-'), 'the description in standard input is empty');
      const empty = await textFile('empty.md', '\uFEFF\n');
      await fails(add('--description-file', empty), `the description in ${empty} is empty`);
      const missing = join(work, 'missing.md');
      await fails(add('--description-file', missing), new Error(`cannot read ${missing}: no such file`));
    });

    it('refuses a description that would break the report', async () => {
      stdin = '```ts\nunclosed';
      await fails(add('--description-file', '-'), /unclosed code fence/u);
      stdin = '#### Updates\nnot a real one';
      await fails(add('--description-file', '-'), /heading/u);
    });

    describe('says in a few words why a description file cannot be read', () => {
      it('names the file as typed, for finding add and for set-description, and changes nothing', async () => {
        await fails(add('--description-file', 'no-such-description.md'), new Error('cannot read no-such-description.md: no such file'));
        await fails(
          ['finding', 'set-description', 'F3', '--description-file', 'no-such-description.md', '--db', review],
          new Error('cannot read no-such-description.md: no such file'),
        );
        const typed = join(docs, 'nope.md');
        await fails(['finding', 'set-description', 'F3', '--description-file', typed, '--db', review], new Error(`cannot read ${typed}: no such file`));
      });

      it('says that the file is a directory', async () => {
        await fails(add('--description-file', docs), new Error(`cannot read ${docs}: is a directory`));
      });

      it.each([
        ['ENOENT', 'no such file'],
        ['EACCES', 'permission denied'],
        ['EPERM', 'permission denied'],
        ['EISDIR', 'is a directory'],
        ['EMFILE', 'too many open files'],
      ])('gives %s as "%s", and any other error as its own message', (code, reason) => {
        const error = Object.assign(new Error('too many open files'), { code });
        expect(readFailure(error)).toBe(reason);
      });
    });

    describe('refuses text that is not UTF-8, before it changes anything', () => {
      const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52]);

      it.each([
        ['UTF-16LE with a BOM, as Windows PowerShell 5.1 writes it', Buffer.from('\uFEFFLooks fine', 'utf16le'), 'is UTF-16 text, not UTF-8'],
        ['UTF-16BE with a BOM', Buffer.from([0xfe, 0xff, 0x00, 0x4c]), 'is UTF-16 text, not UTF-8'],
        ['a PNG image', PNG, 'is not valid UTF-8'],
        ['Latin-1 text', Buffer.from('café', 'latin1'), 'is not valid UTF-8'],
      ])('a description file with %s', async (_what, content, problem) => {
        const file = await textFile('d.bin', content);
        await fails(add('--description-file', file), new Error(`${file} ${problem}; save the file as UTF-8`));
      });

      it.each([
        ['UTF-16LE', Buffer.from('\uFEFFLooks fine', 'utf16le'), 'is UTF-16 text, not UTF-8'],
        ['invalid UTF-8', Buffer.from([0x54, 0xe9, 0x78, 0x74]), 'is not valid UTF-8'],
      ])('standard input with %s', async (_what, content, problem) => {
        stdin = content;
        await fails(add('--description-file', '-'), new Error(`standard input ${problem}; pipe it as UTF-8`));
      });

      it('still takes UTF-8 text that is not ASCII', async () => {
        const file = await textFile('d.md', '\uFEFFnaïve — 🔴 日本語');
        await step(...add('--description-file', file));
        expect((await findingOf('F4'))?.description).toBe('naïve — 🔴 日本語');
      });

      it('exits with 1 and the message on standard error from a real process', async () => {
        const before = await bytes();
        const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...add('--description-file', '-')], {
          input: PNG,
          encoding: 'utf8',
          cwd: work,
        });
        expect(result).toMatchObject({ status: 1, stdout: '', stderr: 'standard input is not valid UTF-8; pipe it as UTF-8\n' });
        expect((await bytes()).equals(before)).toBe(true);
      });
    });
  });

  describe('finding list and show', () => {
    const ALL = ['F1  ✅ 🔴  Missing timeout', 'F2  ✅ 🟡  Remark', 'F3  ⏳ ⚪  Waiting'];

    it('lists the findings, one line each, and how many of the findings of the review they are', async () => {
      expect(await step('finding', 'list')).toBe(0);
      expect(printed).toBe(`${ALL.join('\n')}\n3 of 3 findings\n`);
    });

    it('filters by state and by severity, which are anded, in any spelling', async () => {
      await step('finding', 'list', '--state', 'approved');
      expect(printed).toBe(`${ALL.slice(0, 2).join('\n')}\n2 of 3 findings\n`);
      await step('finding', 'list', '--state', 'awaiting triage');
      expect(printed).toBe(`${ALL[2]}\n1 of 3 findings\n`);
      await step('finding', 'list', '--state', '⏳');
      expect(printed).toBe(`${ALL[2]}\n1 of 3 findings\n`);
      await step('finding', 'list', '--severity', 'medium');
      expect(printed).toBe(`${ALL[1]}\n1 of 3 findings\n`);
      await step('finding', 'list', '--state', 'approved', '--severity', 'low');
      expect(printed).toBe('0 of 3 findings\n');
    });

    it('lists with --unposted the findings that have no own comment, whatever their state, and counts a duplicate as none', async () => {
      await step('finding', 'list', '--unposted');
      expect(printed).toBe(`${ALL.join('\n')}\n3 of 3 findings\n`);

      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'duplicate', 'F2', 'r1002');
      await step('finding', 'list', '--unposted');
      expect(printed).toBe(`${ALL.slice(1).join('\n')}\n2 of 3 findings\n`);
      await step('finding', 'list', '--unposted', '--state', 'awaiting');
      expect(printed).toBe(`${ALL[2]}\n1 of 3 findings\n`);
      await step('finding', 'list', '--unposted', '--state', 'approved');
      expect(printed).toBe(`${ALL[1]}\n1 of 3 findings\n`);
    });

    it('prints an array with --json', async () => {
      await step('finding', 'list', '--json', '--state', 'approved');

      expect(JSON.parse(printed)).toEqual([
        { id: 'F1', state: '✅', stateLabel: 'approved', severity: '🔴', title: 'Missing timeout', updates: 2, anchors: 2 },
        { id: 'F2', state: '✅', stateLabel: 'approved', severity: '🟡', title: 'Remark', updates: 2, anchors: 0 },
      ]);
    });

    it('refuses a state or a severity that is none', async () => {
      await expect(step('finding', 'list', '--state', 'nonsense')).rejects.toThrow('--state "nonsense" is not a state; use one of:');
      await expect(step('finding', 'list', '--severity', 'critical')).rejects.toThrow('--severity "critical" is not a severity; use one of:');
      await expect(step('finding', 'set-state', 'F3', 'nonsense')).rejects.toThrow(/^"nonsense" is not a state; use one of:/u);
    });

    it('shows a finding with its updates, in any case, and its links', async () => {
      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'duplicate', 'F1', COMPLEXITY_REF);
      await step('link', 'note', 'r1004', 'a bot');

      expect(await step('finding', 'show', 'f1')).toBe(0);

      expect(printed).toContain(`### ✅ 🔴 F1 — Missing timeout\nLinked: own r1001, duplicate ${COMPLEXITY_REF}\n\n`);
      expect(printed).toContain(
        `- ${STAMP} — PR comment [r1001](https://ghe.example.com/acme/widgets/pull/157#discussion_r1001) linked as its own\n`,
      );
      expect(printed).toContain(`- ${STAMP} — check annotation ${COMPLEXITY_REF} linked as a duplicate\n`);
      expect(warned).toBe('');
      await step('finding', 'show', 'F3');
      expect(printed).not.toContain('Linked');
    });

    it('prints the finding, its evidence and its links as JSON with --json', async () => {
      await step('link', 'own', 'F1', 'r1001');

      await step('finding', 'show', 'F1', '--json');

      expect(JSON.parse(printed)).toMatchObject({
        id: 'F1',
        state: '✅',
        title: 'Missing timeout',
        evidence: [{ path: 'src/app.ts' }, { path: 'src/other.ts' }],
        comments: [{ ref: 'r1001', role: 'own' }],
      });
    });

    it('refuses a finding that is not there, and names the ones that are', async () => {
      await expect(step('finding', 'show', 'F9')).rejects.toThrow('unknown finding "F9"; the report has F1, F2, F3');
    });
  });

  describe('finding changes', () => {
    it('moves a finding to another state, with the note and the round, and logs it under Updates', async () => {
      expect(await step('finding', 'set-state', 'f3', 'approved', '--note', 'agreed')).toBe(0);
      expect(printed).toBe('F3: ⏳ → ✅\n');
      expect(warned).toBe(line());

      await step('finding', 'set-state', 'F3', 'discarded', '--round', '1');
      expect(printed).toBe('F3: ✅ → ❌\n');
      expect(await updatesOf('F3')).toEqual([
        `${STAMP} — Round 1: raised ⏳`,
        `${STAMP} — ⏳ → ✅ — agreed`,
        `${STAMP} — Round 1: ✅ → ❌`,
      ]);
    });

    it('resolves the revision of a state change, and stores the hash; fixed needs one', async () => {
      await step('finding', 'set-state', 'F1', 'fixed', '--revision', 'abc1234');

      expect(printed).toBe('F1: ✅ → 🔧\n');
      expect(revisions).toEqual(['abc1234']);
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — ✅ → 🔧 at \`abc12345\``);

      await fails(['finding', 'set-state', 'F2', 'fixed', '--db', review], 'moving F2 to 🔧 fixed needs the revision that fixes it');
      await fails(['finding', 'set-state', 'F2', 'fixed', '--revision', 'nope', '--db', review], 'revision "nope" does not exist in this repository');
      await fails(['finding', 'set-state', 'F2', 'fixed', '--revision', ' ', '--db', review], '--revision must not be empty');
      expect(revisions).toEqual(['abc1234', 'nope']);
    });

    it('does not resolve a revision that was not given, and keeps a state without one as it was', async () => {
      await step('finding', 'set-state', 'F3', 'unverified');

      expect(revisions).toEqual([]);
      expect(printed).toBe('F3: ⏳ → ❓\n');
    });

    it('changes the severity, the title and the description, and says what changed', async () => {
      await step('finding', 'set-severity', 'F1', 'medium');
      expect(printed).toBe('F1: 🔴 → 🟡\n');
      await step('finding', 'set-title', 'F1', 'Missing retry timeout', '--note', 'clearer');
      expect(printed).toBe('F1: retitled\n');
      stdin = 'The retry loop never gives up.\n\n`src/a.ts:3-5`\n\nMore detail.\n';
      await step('finding', 'set-description', 'F1', '--description-file', '-', '--round', '1');
      expect(printed).toBe('F1: description replaced\n');

      expect((await findingOf('F1'))?.description).toBe('The retry loop never gives up.\n\n`src/a.ts:3-5`\n\nMore detail.');
      expect(await updatesOf('F1')).toEqual([
        `${STAMP} — Round 1: raised ⏳`,
        `${STAMP} — ⏳ → ✅`,
        `${STAMP} — severity 🔴 → 🟡`,
        `${STAMP} — title changed: "Missing timeout" → "Missing retry timeout" — clearer`,
        `${STAMP} — Round 1: description revised`,
      ]);
    });

    it('adds an update with the text and the round', async () => {
      expect(await step('finding', 'update', 'F1', 'Asked the author', '--round', '1')).toBe(0);

      expect(printed).toBe('F1: note added\n');
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — Round 1: Asked the author`);
    });

    it('refuses what changes nothing or cannot be done, and leaves the database as it was', async () => {
      await fails(['finding', 'set-state', 'F9', 'approved', '--db', review], 'unknown finding "F9"');
      await fails(['finding', 'set-state', 'F1', 'approved', '--db', review], 'F1 is already ✅ approved');
      await fails(['finding', 'set-state', 'F3', 'nonsense', '--db', review], '"nonsense" is not a state');
      await fails(['finding', 'set-state', 'F3', ' ', '--db', review], 'the state must not be empty');
      await fails(['finding', 'set-severity', 'F1', 'high', '--db', review], 'F1 already has severity 🔴');
      await fails(['finding', 'set-severity', 'F1', 'critical', '--db', review], '"critical" is not a severity; use one of: high, medium, low');
      await fails(['finding', 'set-title', 'F1', 'Missing timeout', '--db', review], 'F1 already has the title');
      await fails(['finding', 'set-title', 'F1', ' ', '--db', review], 'the title must not be empty');
      await fails(['finding', 'update', 'F1', ' ', '--db', review], 'the text must not be empty');
      await fails(['finding', 'update', 'F1', 'x', '--round', '2', '--db', review], 'round 2 was never opened; the latest round is 1');
      for (const round of ['0', '-1', '1.5', 'abc', '']) {
        await fails(['finding', 'update', 'F1', 'x', `--round=${round}`, '--db', review], '--round must be a positive whole number');
      }
    });
  });

  describe('link', () => {
    const linksOf = async () => (await loaded()).links;
    const remove = (ref: string) => `remove that link first with "pr-comments link remove --db ${review} ${ref}"`;

    it('links an existing comment as the own comment of a finding, logs it under Updates and prints one line', async () => {
      expect(await step('link', 'own', 'f3', 'r1001', '--note', 'written by hand')).toBe(0);

      expect(printed).toBe('F3: own comment r1001 linked\n');
      expect(warned).toBe(line());
      expect(await linksOf()).toMatchObject([{ ref: 'r1001', role: 'own', finding: 'F3' }]);
      expect((await updatesOf('F3'))?.at(-1)).toBe(
        `${STAMP} — PR comment [r1001](https://ghe.example.com/acme/widgets/pull/157#discussion_r1001) linked as its own — written by hand`,
      );
    });

    it('accepts upper-case comment and annotation refs across link commands', async () => {
      expect(await step('link', 'own', 'F1', 'R1001')).toBe(0);
      expect(printed).toBe('F1: own comment r1001 linked\n');
      expect(await step('link', 'duplicate', 'F1', ELSE_IF_REF.toUpperCase())).toBe(0);
      expect(printed).toBe(`F1: duplicate ${ELSE_IF_REF} linked\n`);
      expect(await step('link', 'note', 'C2001', 'a note')).toBe(0);
      expect(printed).toBe('c2001: noted\n');
      expect(await step('link', 'remove', 'C2001')).toBe(0);
      expect(printed).toBe('c2001 unlinked\n');
    });

    it('links duplicates, comments and check annotations, as many as there are, in the order they were made', async () => {
      await step('link', 'duplicate', 'F1', 'r1004');
      expect(printed).toBe('F1: duplicate r1004 linked\n');
      await step('link', 'duplicate', 'F1', 'c2001', '--note', 'the same point, in the conversation');
      await step('link', 'duplicate', 'F1', ELSE_IF_REF);
      await step('link', 'own', 'F1', 'r1001');

      expect((await linksOf()).map(({ ref, role, finding }) => [ref, role, finding])).toEqual([
        ['r1004', 'duplicate', 'F1'],
        ['c2001', 'duplicate', 'F1'],
        [ELSE_IF_REF, 'duplicate', 'F1'],
        ['r1001', 'own', 'F1'],
      ]);
      expect((await updatesOf('F1'))?.slice(2)).toEqual([
        `${STAMP} — PR comment ${LINKED.r1004} linked as a duplicate`,
        `${STAMP} — PR comment ${LINKED.c2001} linked as a duplicate — the same point, in the conversation`,
        `${STAMP} — check annotation ${ELSE_IF_REF} linked as a duplicate`,
        `${STAMP} — PR comment ${LINKED.r1001} linked as its own`,
      ]);
    });

    it('records that a comment is not a finding and why, and changes no finding', async () => {
      const before = (await loaded()).data.findings;

      expect(await step('link', 'note', 'r1004', 'a bot summary')).toBe(0);

      expect(printed).toBe('r1004: noted\n');
      expect(await linksOf()).toMatchObject([{ ref: 'r1004', role: 'note', note: 'a bot summary' }]);
      expect((await loaded()).data.findings).toEqual(before);
    });

    it('unlinks a comment of any role: a finding logs it, a note leaves no trace', async () => {
      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'duplicate', 'F2', 'r1004');
      await step('link', 'note', 'c2001', 'a bot');

      expect(await step('link', 'remove', 'r1004', '--note', 'a different issue')).toBe(0);
      expect(printed).toBe('r1004 unlinked\n');
      await step('link', 'remove', 'c2001');
      expect(printed).toBe('c2001 unlinked\n');
      await step('link', 'remove', 'r1001');

      expect(await linksOf()).toEqual([]);
      expect((await updatesOf('F2'))?.slice(2)).toEqual([
        `${STAMP} — PR comment ${LINKED.r1004} linked as a duplicate`,
        `${STAMP} — PR comment ${LINKED.r1004} unlinked (was a duplicate) — a different issue`,
      ]);
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — PR comment ${LINKED.r1001} unlinked (was its own)`);
    });

    it('refuses a comment that is not in the database, and an id that is no comment', async () => {
      await fails(['link', 'own', 'F1', 'r999', '--db', review], `r999 is not in the database; run "pr-comments pr sync --db ${review}" first, or check the id`);
      await fails(['link', 'duplicate', 'F1', 'c999', '--db', review], 'c999 is not in the database');
      await fails(['link', 'duplicate', 'F1', 'a00000000', '--db', review], 'a00000000 is not in the database');
      await fails(['link', 'note', 'r999', 'text', '--db', review], 'r999 is not in the database');
      await fails(['link', 'own', 'F1', '1001', '--db', review], '"1001" is not a PR comment ref');
      await fails(['link', 'own', 'F9', 'r1001', '--db', review], 'unknown finding "F9"; the report has F1, F2, F3');
    });

    it('refuses a second own comment, a comment that is linked already, and says how to unlink', async () => {
      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'note', 'r1004', 'a bot');

      await fails(['link', 'own', 'F1', 'r1003', '--db', review], `F1 already has its own comment r1001; ${remove('r1001')}`);
      await fails(['link', 'duplicate', 'F2', 'r1001', '--db', review], `r1001 is already linked as the own comment of F1; ${remove('r1001')}`);
      await fails(['link', 'duplicate', 'F2', 'r1004', '--db', review], `r1004 is already linked as a note (a bot); ${remove('r1004')}`);
    });

    it('refuses a check annotation as an own comment and as a note, and the removal of what is not linked', async () => {
      await fails(['link', 'own', 'F1', UNUSED_REF, '--db', review], `${UNUSED_REF} is a check annotation: it can only be linked as a duplicate of a finding`);
      await fails(['link', 'note', UNUSED_REF, 'text', '--db', review], `${UNUSED_REF} is a check annotation`);
      await fails(['link', 'remove', 'r1001', '--db', review], 'r1001 is not linked in this review; the review has no links');
      await step('link', 'note', 'r1004', 'a bot');
      await fails(['link', 'remove', 'r1001', '--db', review], 'r1001 is not linked in this review; it has r1004');
      await fails(['link', 'own', 'F1', 'r1001', '--note', ' ', '--db', review], '--note must not be empty');
      await fails(['link', 'note', 'r1001', ' ', '--db', review], 'note is empty');
      await fails(['link', 'note', 'r1001', 'two\nlines', '--db', review], 'note must be one line');
    });

    it('keeps a link to a comment that the next sync no longer has, and a removal still works', async () => {
      await step('link', 'own', 'F1', 'r1001');
      snapshot = withChecks();
      snapshot.comments = snapshot.comments.filter(({ id }) => id !== 'rc-1');

      await step('pr', 'sync');

      expect(await linksOf()).toMatchObject([{ ref: 'r1001', role: 'own', finding: 'F1' }]);
      await fails(['link', 'duplicate', 'F2', 'r1001', '--db', review], 'r1001 is not in the database');
      expect(await step('link', 'remove', 'r1001')).toBe(0);
      expect(await linksOf()).toEqual([]);
    });
  });

  describe('link pending', () => {
    const REFS = ['r1001', 'r1004', 'c2001', COMPLEXITY_REF, ELSE_IF_REF, COMMENTED_OUT_REF, UNUSED_REF];

    it('prints the comments and check annotations that are not linked yet, one line each, and nothing else', async () => {
      expect(await step('link', 'pending')).toBe(0);

      const expected = pendingLines(pendingItems({ links: [], data: withChecks() }));
      expect(printed).toBe(`${expected.join('\n')}\n`);
      expect(expected.length).toBeGreaterThanOrEqual(REFS.length);
      for (const ref of REFS) expect(printed, ref).toContain(ref);
      // The replies of a thread are not listed: the root stands for it.
      expect(printed).not.toContain('r1002');
      expect(printed).not.toContain('r1003');
      expect(warned).toBe('');
    });

    it('lists what is not linked yet, and prints nothing at all when everything is processed, with exit 0', async () => {
      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'note', 'r1004', 'a bot');
      await step('link', 'duplicate', 'F1', COMPLEXITY_REF);

      expect(await step('link', 'pending')).toBe(0);
      expect(printed).not.toContain('r1001');
      expect(printed).not.toContain('r1004');
      expect(printed).not.toContain(COMPLEXITY_REF);
      for (const ref of ['c2001', ELSE_IF_REF, COMMENTED_OUT_REF, UNUSED_REF]) expect(printed, ref).toContain(ref);

      await step('link', 'note', 'c2001', 'a thank you');
      for (const ref of [ELSE_IF_REF, COMMENTED_OUT_REF, UNUSED_REF]) await step('link', 'duplicate', 'F2', ref);
      expect(await step('link', 'pending')).toBe(0);
      expect(printed).toBe('');
      expect(warned).toBe('');
    });

    it('prints the items as a JSON array with --json, and [] when there are none', async () => {
      await step('link', 'pending', '--json');
      const items = JSON.parse(printed) as { ref: string; kind: string }[];
      expect(items.map(({ ref }) => ref).sort()).toEqual([...REFS].sort());
      expect(items.find(({ ref }) => ref === 'c2001')).toMatchObject({ kind: 'issue', author: 'alice' });
      expect(items.find(({ ref }) => ref === COMPLEXITY_REF)).toMatchObject({ kind: 'check', path: 'src/retry.ts' });

      for (const ref of ['r1001', 'r1004', 'c2001']) await step('link', 'note', ref, 'x');
      for (const ref of [COMPLEXITY_REF, ELSE_IF_REF, COMMENTED_OUT_REF, UNUSED_REF]) await step('link', 'duplicate', 'F1', ref);
      await step('link', 'pending', '--json');
      expect(printed).toBe('[]\n');
    });

    it('says to sync first when the database holds no pull request, with exit 1', async () => {
      const db = join(docs, 'bare_review.sqlite');
      await step('init', 'Bare', '--db', db, '--pr', prUrl);

      await expect(step('link', 'pending', '--db', db)).rejects.toThrow(`no pull request data in the database; run "pr-comments pr sync --db ${db}" first`);
      await expect(step('link', 'pending', '--db', db, '--json')).rejects.toThrow('no pull request data in the database');
      expect(printed).toBe('');
    });
  });

  describe('report', () => {
    describe('render', () => {
      const report = () => join(docs, 'demo_review.md');

      it('says created, unchanged and updated, and writes the report the database renders to', async () => {
        expect(await step('report', 'render')).toBe(0);
        expect(printed).toBe(`created   ${report()}\n`);
        const text = await readFile(report(), 'utf8');
        expect(text).toBe(renderReport((await loaded()).data));
        expect(parseReport(text, report()).findings.map(({ id }) => id)).toEqual(['F1', 'F2', 'F3']);

        await step('report', 'render');
        expect(printed).toBe(`unchanged ${report()}\n`);

        await step('finding', 'set-state', 'F3', 'approved');
        expect(await readFile(report(), 'utf8')).toContain('### ✅ ⚪ F3 — Waiting');
        await step('report', 'render');
        expect(printed).toBe(`unchanged ${report()}\n`);
      });

      it('replaces a report that was edited by hand, with no hand-edit guard and no --force', async () => {
        await step('report', 'render');
        await writeFile(report(), 'A hand-written text.\n', 'utf8');

        await step('report', 'render');

        expect(printed).toBe(`updated   ${report()}\n`);
        expect(await readFile(report(), 'utf8')).toBe(renderReport((await loaded()).data));
        await expect(step('report', 'render', '--force')).rejects.toThrow(mistake('report render', 'unknown option --force'));
      });

      it('writes to --out instead, in a folder it creates, and names that file', async () => {
        const out = join(work, 'reports', 'copy.md');

        await step('report', 'render', '--out', out);

        expect(printed).toBe(`created   ${out}\n`);
        expect(await readFile(out, 'utf8')).toBe(renderReport((await loaded()).data));
        expect(await exists(report())).toBe(false);
      });

      it('never writes over the database, another SQLite file or a name that is none, and leaves them as they were', async () => {
        const before = await bytes();
        const other = join(docs, 'other.sqlite');
        await copyFile(review, other);
        const disguised = join(docs, 'disguised.md');
        await copyFile(review, disguised);

        await expect(step('report', 'render', '--out', review)).rejects.toThrow('refusing to write the report over the database');
        await expect(step('report', 'render', '--out', other)).rejects.toThrow(/refusing to overwrite the SQLite database|must be a report file/u);
        await expect(step('report', 'render', '--out', disguised)).rejects.toThrow('refusing to overwrite the SQLite database');
        await expect(step('report', 'render', '--out', join(docs, 'new.sqlite'))).rejects.toThrow('--out must be a report file, not a database');

        expect((await bytes()).equals(before)).toBe(true);
        expect((await readFile(other)).equals(before)).toBe(true);
        expect(await exists(join(docs, 'new.sqlite'))).toBe(false);
      });
    });

    describe('comments', () => {
      it('prints the pull request as markdown, from the database, with the check annotations as the last section', async () => {
        expect(await step('report', 'comments')).toBe(0);

        expect(printed).toBe(renderMarkdown(withChecks()));
        expect(printed).toContain('# Add retry policy');
        expect(printed).toContain('  Should this be configurable?');
        const checks = printed.split('\n## Checks\n\n')[1];
        expect(checks).toBe(
          [
            '### Lint — neutral',
            '',
            '`github-actions` · commit `ccccccc` · 1 annotation',
            '',
            `- \`${UNUSED_REF}\` **warning** \`src/util.ts:7\` — ${UNUSED}`,
            '',
            '### SonarQube Code Analysis — failure',
            '',
            '`sq-community-pr-decoration` · commit `ccccccc` · 3 annotations · [link](https://sonar.example.com/dashboard?id=widgets&pullRequest=157)',
            '',
            `- \`${COMMENTED_OUT_REF}\` **notice** \`docs/readme.md:5\` — ${COMMENTED_OUT}`,
            `- \`${COMPLEXITY_REF}\` **failure** \`src/retry.ts:42\` — ${COMPLEXITY}`,
            `- \`${ELSE_IF_REF}\` **warning** \`src/retry.ts:50-55\` — ${ELSE_IF}`,
            '',
          ].join('\n'),
        );
        expect(warned).toBe('');
      });

      it('keeps only one author when asked, and the app that published the check annotations is the author of those', async () => {
        await step('report', 'comments', '--author', 'carol');
        expect(printed).toContain('Typo here.');
        expect(printed).not.toContain('Should this be configurable?');

        await step('report', 'comments', '--author', SONAR);
        expect(printed).toContain('- Filter: only comments by @sq-community-pr-decoration');
        expect(printed).toContain('### SonarQube Code Analysis — failure');
        expect(printed).not.toContain('### Lint');
        expect(printed).not.toContain('## Conversation');
        expect(warned).toBe('');
      });

      it('takes several authors from a comma-separated list or a repeated option', async () => {
        for (const args of [['--author=carol,bob'], ['--author', 'carol', '--author', 'bob'], ['--author', ' carol , bob ,'], ['--author=carol bob']]) {
          await step('report', 'comments', ...args);
          expect(printed, args.join(' ')).toContain('- Filter: only comments by @carol, @bob');
          expect(printed).toContain('Typo here.');
          expect(printed).toContain('Should this be configurable?');
          expect(printed).toContain('Yes, added an option.');
        }
        expect(warned).toBe('');
      });

      it('warns about an author who has nothing in the pull request, but still prints the others', async () => {
        await step('report', 'comments', '--author', 'carol,carool');

        expect(warned).toBe('Warning: no comments, reviews or check annotations by carool in this pull request\n');
        expect(printed).toContain('Typo here.');
      });

      it('refuses an author option without any login', async () => {
        await expect(step('report', 'comments', '--author', ' , ')).rejects.toThrow('--author needs at least one login');
      });

      it('filters by --ref and --pending, and validates ref format', async () => {
        await step('link', 'note', 'r1001', 'handled');
        await step('report', 'comments', '--pending');
        expect(printed).toContain('- Filter: only pending comments and check annotations');
        expect(printed).toContain('`r1004`');
        expect(printed).not.toContain('`r1001`');

        await step('report', 'comments', '--ref', `r1001,${COMPLEXITY_REF},r9999`);
        expect(warned).toBe('Warning: no comment or check annotation r9999 in this pull request\n');
        expect(printed).toContain(`- Filter: only refs \`r1001\`, \`${COMPLEXITY_REF}\`, \`r9999\``);
        expect(printed).toContain('`r1001`');
        expect(printed).toContain(`\`${COMPLEXITY_REF}\``);
        expect(printed).not.toContain('`r1004`');

        await expect(step('report', 'comments', '--ref', ' , ')).rejects.toThrow('--ref needs at least one ref');
        await expect(step('report', 'comments', '--ref', 'bogus')).rejects.toThrow(
          '"bogus" is not a comment or check annotation id; expected r544830, c623843 or a3f9c2d1e',
        );
      });

      it('shows a newly synced reply in a linked thread via unfiltered or --ref reads while --pending omits the linked root', async () => {
        await step('link', 'duplicate', 'F1', 'r1001');
        const current = withChecks();
        const root = current.comments.find((comment) => comment.url.endsWith('#discussion_r1001'))!;
        snapshot = {
          ...current,
          comments: [
            ...current.comments,
            {
              ...root,
              id: 'id-r1005',
              threadPosition: 2,
              replyToId: root.id,
              author: 'erin',
              body: 'Follow-up reply with new counter-evidence.',
              createdAt: '2026-01-05T11:00:00Z',
              updatedAt: '2026-01-05T11:00:00Z',
              url: `${prUrl}#discussion_r1005`,
            },
          ],
        };
        await step('pr', 'sync');

        await step('report', 'comments', '--pending');
        expect(printed).not.toContain('`r1001`');
        expect(printed).not.toContain('`r1005`');

        await step('report', 'comments', '--ref', 'r1001');
        expect(printed).toContain('`r1001`');
        expect(printed).toContain('`r1005`');
        expect(printed).toContain('Follow-up reply with new counter-evidence.');

        await step('report', 'comments');
        expect(printed).toContain('`r1005`');
        expect(printed).toContain('Follow-up reply with new counter-evidence.');
      });

      it('writes the markdown to a file, creating the folder, and says so', async () => {
        const out = join(work, 'reports', 'pr-157.md');

        await step('report', 'comments', '--out', out);

        expect(printed).toBe(`Wrote ${out}\n`);
        expect(await readFile(out, 'utf8')).toBe(renderMarkdown(withChecks()));
      });

      describe('never writes over a database, under whatever name it is reached', () => {
        // The error is the guard's, nothing is printed, and the database is byte for byte as it was; so is the file
        // that was named, when it is a copy of or a link to it.
        async function refused(out: string, message: string | RegExp, holdsDatabase = true): Promise<void> {
          const before = await bytes();
          await expect(step('report', 'comments', '--out', out)).rejects.toThrow(message);
          expect(printed).toBe('');
          expect((await bytes()).equals(before)).toBe(true);
          if (holdsDatabase) expect((await readFile(out)).equals(before)).toBe(true);
        }

        it('refuses the database itself, in any spelling of its path', async () => {
          await refused(review, `refusing to write the report over the database ${review}`);
          await refused(`${docs}/./demo_review.sqlite`, 'refusing to write the report over the database');
        });

        it('refuses a copy of it, whatever its name, even one that is called a report', async () => {
          const copy = join(docs, 'copy.db');
          await copyFile(review, copy);
          await refused(copy, `refusing to overwrite the SQLite database ${copy}`);
          const disguised = join(docs, 'disguised.md');
          await copyFile(review, disguised);
          await refused(disguised, 'refusing to overwrite the SQLite database');
        });

        it('refuses a name that ends in .sqlite, whether the file is there or not, before it creates anything', async () => {
          const folder = join(work, 'new-folder');
          await refused(join(folder, 'new.sqlite'), '--out must be a report file, not a database', false);
          await refused(join(docs, 'NEW.SQLite'), '--out must be a report file, not a database', false);
          expect(await exists(folder)).toBe(false);
          expect(await exists(join(docs, 'NEW.SQLite'))).toBe(false);
        });

        it('refuses a hard link to it', async ({ skip }) => {
          const hard = join(docs, 'hard.md');
          await link(review, hard).catch((error: unknown) => skip(`hard links are not available here: ${(error as Error).message}`));
          await refused(hard, 'refusing to overwrite the SQLite database');
        });

        it('refuses a symbolic link to it', async ({ skip }) => {
          const symbolic = join(docs, 'symbolic.md');
          await symlink(review, symbolic).catch((error: unknown) => skip(`symbolic links are not available here: ${(error as Error).message}`));
          await refused(symbolic, 'refusing to overwrite the SQLite database');
        });

        it('refuses the NTFS stream name of it', async ({ skip }) => {
          if (process.platform !== 'win32') skip('::$DATA stream names exist on NTFS only');
          await refused(`${review}::$DATA`, /refusing to (write the report over|overwrite) the|--out must be a report file/u);
        });

        it('still writes a report that is none of these, whatever it held', async () => {
          const out = join(docs, 'other.md');
          await writeFile(out, 'old text', 'utf8');

          await step('report', 'comments', '--out', out);

          expect(await readFile(out, 'utf8')).toBe(renderMarkdown(withChecks()));
        });
      });

      it('says to sync first when the database holds no pull request', async () => {
        const db = join(docs, 'bare_review.sqlite');
        await step('init', 'Bare', '--db', db, '--pr', prUrl);

        await expect(step('report', 'comments', '--db', db)).rejects.toThrow(`no pull request data in the database; run "pr-comments pr sync --db ${db}" first`);
        expect(printed).toBe('');
      });

      it('shows what the last sync stored', async () => {
        snapshot = withChecks();
        snapshot.comments.find(({ id }) => id === 'rc-1')!.body = 'Rewritten after discussion';
        snapshot.comments = snapshot.comments.filter(({ id }) => id !== 'rc-2');
        await step('pr', 'sync');

        await step('report', 'comments');

        expect(printed).toContain('  Rewritten after discussion');
        expect(printed).not.toContain('Yes, added an option.');
      });
    });

    it('dumps the review as text, for git diffs', async () => {
      await step('link', 'own', 'F1', 'r1001');

      expect(await step('report', 'dump')).toBe(0);

      expect(printed).toBe(await dumpReviewFile(review));
      expect(printed).toContain('r1001');
      expect(warned).toBe('');
    });
  });

  describe('finding post', () => {
    const F1_BODY = [
      '🔴 **F1 — Missing timeout**',
      '',
      'Crash when the list is empty; see the helper.',
      '',
      '`src/app.ts:10-12`',
      '',
      'Second place, same cause.',
      '',
      '`src/other.ts:7`',
    ].join('\n');
    const GENERAL_WARNING = 'Warning: F2 has no path:lines anchor; it becomes a general comment (posting it needs --now)\n';
    let calls: { ref: unknown; comment: PublishComment; options: PublishOptions }[];
    let refreshes: number;

    // What GitHub would answer for the one comment: a dry run has no comment for what it would create.
    const answer = (comment: PublishComment, options: PublishOptions, action: 'created' | 'updated' | 'unchanged', ref: string): PublishResult => {
      const { path, lines } = comment;
      const planned = options.dryRun && action === 'created';
      return {
        action,
        dryRun: options.dryRun,
        ...(planned ? {} : { comment: ref, url: ref.startsWith('c') ? `${prUrl}#issuecomment-${ref.slice(1)}` : `${prUrl}#discussion_${ref}` }),
        state: options.now ? 'posted' : 'pending',
        ...(path === undefined ? {} : { path }),
        ...(lines === undefined ? {} : { lines: lines.start === lines.end ? `${lines.start}` : `${lines.start}-${lines.end}` }),
      };
    };

    // The publish engine, as far as the command sees it: the hook awaited and its answer taking the result's place.
    const engine = (reply: (comment: PublishComment, options: PublishOptions) => PublishResult) => {
      env.publish = async (ref, comment, options, hooks) => {
        calls.push({ ref, comment, options });
        const result = reply(comment, options);
        return hooks.onResult === undefined ? result : hooks.onResult(result);
      };
    };
    const creates = (ref = 'r2001') => engine((comment, options) => answer(comment, options, 'created', ref));
    const ownOf = async (id: string) => (await loaded()).links.filter(({ finding, role }) => finding === id && role === 'own');
    const post = (...args: string[]) => step('finding', 'post', '--db', review, ...args);
    const url = (comment: string) => (comment.startsWith('c') ? `${prUrl}#issuecomment-${comment.slice(1)}` : `${prUrl}#discussion_${comment}`);

    beforeEach(() => {
      calls = [];
      refreshes = 0;
      // The pull request as GitHub gives it once the comment exists.
      env.getPullRequest = async () => {
        refreshes += 1;
        return withComments('r2001', 'c2002');
      };
    });

    it('posts the finding to the pull request of the review, prints the result and the anchors, and records the own comment', async () => {
      creates();

      expect(await post('f1')).toBe(0);

      expect(printed).toBe(`created    pending  r2001  src/app.ts:10-12  ${url('r2001')}\nanchor 1 of 2: src/app.ts:10-12\n  2. src/other.ts:7\nlinks removed: 1\n`);
      expect(warned).toBe(line());
      expect(calls).toHaveLength(1);
      expect(calls[0]!.ref).toEqual(PR_REF);
      expect(calls[0]!.options).toEqual({ byAgent: false, now: false, dryRun: false });
      expect(calls[0]!.comment).toMatchObject({ path: 'src/app.ts', lines: { start: 10, end: 12 }, body: F1_BODY });
      expect(refreshes).toBe(1);
      expect(await ownOf('F1')).toMatchObject([{ ref: 'r2001', role: 'own', finding: 'F1' }]);
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — posted PR comment ${LINKED.r2001} to the pending review`);
      // The refreshed pull request is in the database, so that the link points at a comment that exists.
      expect((await loadSnapshot(review))?.comments.map(({ url: commentUrl }) => commentUrl)).toContain(url('r2001'));
    });

    it('publishes at once with --now, starts with the agent line with --by-agent, and takes --anchor and --commit', async () => {
      creates();

      expect(await post('F1', '--now', '--by-agent', '--anchor', '2', '--commit', 'abcdef1')).toBe(0);

      expect(printed).toBe(`created    posted   r2001  src/other.ts:7  ${url('r2001')}\nanchor 2 of 2: src/other.ts:7\n  1. src/app.ts:10-12\nlinks removed: 1\n`);
      expect(calls[0]!.options).toEqual({ byAgent: true, now: true, dryRun: false });
      expect(calls[0]!.comment).toMatchObject({ path: 'src/other.ts', lines: { start: 7, end: 7 }, commit: 'abcdef1', body: F1_BODY });
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — posted PR comment ${LINKED.r2001}`);
    });

    it('with --dry-run prints what would happen and the exact text, writes nothing, downloads nothing and names no database', async () => {
      creates();
      const before = await bytes();

      expect(await post('F1', '--dry-run', '--by-agent')).toBe(0);

      const label = 'would create'.padEnd('would leave unchanged'.length);
      expect(printed).toBe(
        [
          `${label}  pending  -  src/app.ts:10-12`,
          'anchor 1 of 2: src/app.ts:10-12',
          '  2. src/other.ts:7',
          'links removed: 1',
          '----- comment text -----',
          `${AGENT_DISCLAIMER}\n\n${F1_BODY}`,
          '-----',
          '',
        ].join('\n'),
      );
      expect(calls[0]!.options).toEqual({ byAgent: true, now: false, dryRun: true });
      expect(refreshes).toBe(0);
      expect(warned).toBe('');
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('updates the own comment when run again, and records nothing twice when it stays unchanged', async () => {
      creates();
      await post('F1');
      const before = await updatesOf('F1');

      engine((comment, options) => answer(comment, options, 'unchanged', 'r2001'));
      expect(await post('F1')).toBe(0);
      expect(printed.startsWith(`unchanged  pending  r2001  src/app.ts:10-12  ${url('r2001')}\n`)).toBe(true);
      expect(calls[1]!.comment.commentRef).toBe('r2001');
      expect(await updatesOf('F1')).toEqual(before);

      stdin = F1_DESCRIPTION.replace('Crash', 'Hang');
      await step('finding', 'set-description', 'F1', '--description-file', '-', '--db', review);
      engine((comment, options) => answer(comment, options, 'updated', 'r2001'));
      expect(await post('F1')).toBe(0);
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — updated PR comment ${LINKED.r2001}`);
      expect(await ownOf('F1')).toHaveLength(1);
    });

    it('adopts an identical comment of yours as the own comment', async () => {
      engine((comment, options) => answer(comment, options, 'unchanged', 'r2001'));

      expect(await post('F1')).toBe(0);

      expect(await ownOf('F1')).toHaveLength(1);
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — adopted PR comment ${LINKED.r2001} (identical)`);
    });

    it('prints an error result and the anchors, exits with 1, records nothing and names no database', async () => {
      engine((_comment, options) => ({ action: 'error', dryRun: options.dryRun, message: 'rejected by GitHub' }));
      const before = await bytes();

      expect(await post('F1')).toBe(1);

      expect(printed).toBe(
        `${'error'.padEnd(9)}  ${''.padEnd('pending'.length)}  -  rejected by GitHub\nanchor 1 of 2: src/app.ts:10-12\n  2. src/other.ts:7\nlinks removed: 1\n`,
      );
      expect(warned).toBe('');
      expect(refreshes).toBe(0);
      expect((await bytes()).equals(before)).toBe(true);
    });

    it.each([
      ['gone', 'comment r1001 no longer exists in this pull request', ''],
      ['moved', 'comment r1001 is on src/app.ts:30, the finding says src/app.ts:10-12; an existing comment cannot be moved', '; r1001 stays on GitHub until you delete it'],
      ['not-yours', 'comment r1001 was written by mallory; only your own comments can be updated', ''],
    ] as const)('prints the way on for an own comment that is %s, and keeps the reason out of the JSON result', async (reason, message, stays) => {
      await step('link', 'own', 'F1', 'r1001');
      engine((_comment, options) => ({ action: 'error', dryRun: options.dryRun, message, reason }));
      const advice = `${message}; remove the link with "pr-comments link remove --db ${review} r1001" and post again (that creates a new comment${stays})`;

      expect(await post('F1', '--json')).toBe(1);
      expect(JSON.parse(printed).result).toEqual({ action: 'error', dryRun: false, message: advice });

      expect(await post('F1')).toBe(1);
      expect(printed.split('\n')[0]).toBe(`${'error'.padEnd(9)}  ${''.padEnd('pending'.length)}  -  ${advice}`);
      expect(refreshes).toBe(0);
    });

    it('turns a pull request that cannot be refreshed into an error result that says how to go on, and records nothing', async () => {
      creates();
      env.getPullRequest = async () => {
        throw new Error('GitHub is down');
      };
      const before = await bytes();

      expect(await post('F1')).toBe(1);

      expect(printed).toContain('the comment was posted as r2001, but the pull request could not be refreshed (GitHub is down)');
      expect(printed).toContain('pr-comments pr sync');
      expect(warned).toBe('');
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('prints a finding with no anchor as a general comment, and the warnings on stderr', async () => {
      creates('c2002');

      expect(await post('F2', '--now')).toBe(0);

      expect(printed).toBe(`created    posted   c2002  (general)  ${url('c2002')}\nno anchor: general comment\n`);
      expect(warned).toBe(`${GENERAL_WARNING}${line()}`);
    });

    it('prints only the result as JSON with --json, keeping the warnings on stderr, and exits with 1 for an error result', async () => {
      creates();

      expect(await post('F1', '--json')).toBe(0);

      const result = { action: 'created', dryRun: false, comment: 'r2001', url: url('r2001'), state: 'pending', path: 'src/app.ts', lines: '10-12' };
      const { data } = await loaded();
      const reportLine = (needle: string) => renderReport(data).split('\n').findIndex((text) => text.includes(needle)) + 1;
      expect(JSON.parse(printed)).toEqual({
        finding: 'F1',
        result,
        anchors: [
          { index: 1, path: 'src/app.ts', lines: '10-12', reportLine: reportLine('`src/app.ts:10-12`') },
          { index: 2, path: 'src/other.ts', lines: '7', reportLine: reportLine('`src/other.ts:7`') },
        ],
        chosen: 1,
        warnings: [],
        unlinked: 1,
        body: F1_BODY,
      });

      creates('c2002');
      await post('F2', '--json', '--now');
      expect(JSON.parse(printed)).toMatchObject({ finding: 'F2', anchors: [], chosen: null, warnings: [GENERAL_WARNING.slice('Warning: '.length, -1)] });
      expect(warned).toBe(`${GENERAL_WARNING}${line()}`);

      engine((_comment, options) => ({ action: 'error', dryRun: options.dryRun, message: 'rejected by GitHub' }));
      expect(await post('F1', '--json')).toBe(1);
      expect(JSON.parse(printed)).toMatchObject({ finding: 'F1', result: { action: 'error', message: 'rejected by GitHub' } });
      expect(warned).toBe('');
    });

    it('posts a finding that is not approved too: the state of a finding does not matter', async () => {
      creates('c2002');

      expect(await post('F3', '--now')).toBe(0);

      expect(printed).toBe(`created    posted   c2002  (general)  ${url('c2002')}\nno anchor: general comment\n`);
      expect((await loaded()).links).toEqual([{ ref: 'c2002', role: 'own', finding: 'F3' }]);
    });

    it('refuses, before it publishes anything, a finding that is not there, and a bad --anchor or --commit', async () => {
      creates();

      await fails(['finding', 'post', 'F9', '--db', review], 'unknown finding "F9"; the report has F1, F2, F3');
      await fails(['finding', 'post', 'F1', '--anchor', '3', '--db', review], '--anchor 3 is out of range: F1 has 2 path:lines anchors');
      for (const value of ['0', '-1', '1.5', 'abc', '', '+1']) {
        await fails(['finding', 'post', 'F1', `--anchor=${value}`, '--db', review], new Error('--anchor must be a positive whole number'));
      }
      await fails(['finding', 'post', 'F1', '--commit', 'main', '--db', review], 'commit "main" must be 7-40 hex digits');
      expect(calls).toEqual([]);
    });

    it('refuses a review that is not connected to a pull request', async () => {
      const db = join(docs, 'bare_review.sqlite');
      await step('init', 'Bare', '--db', db);
      creates();

      await expect(step('finding', 'post', 'F1', '--db', db)).rejects.toThrow(/not connected to a pull request; connect it with "pr-comments pr connect/u);
      expect(calls).toEqual([]);
    });
  });

  describe('link reply', () => {
    const OWN_LINK = `${prUrl}#discussion_r1001`;
    const TEXT = `Duplicate of ${OWN_LINK}.`;
    const WITH_DISCLAIMER = `${AGENT_DISCLAIMER}\n\n${TEXT}`;
    const THREAD: ReplyTarget = { ref: 'r1004', author: 'carol', kind: 'review', path: 'docs/readme.md', lines: '7', resolved: false };
    const CONVERSATION: ReplyTarget = { ref: 'c2001', author: 'alice', kind: 'issue' };
    const NEEDS_NOW = 'a conversation comment can only be answered with a new conversation comment, which is visible at once; add --now to do that';
    const urlOf = (reply: string) => (reply.startsWith('c') ? `${prUrl}#issuecomment-${reply.slice(1)}` : `${prUrl}#discussion_${reply}`);
    type Answer = (request: ReplyRequest, options: ReplyOptions) => ReplyResult;
    let calls: { ref: unknown; request: ReplyRequest; options: ReplyOptions }[];
    let refreshes: number;

    const engine = (answer: Answer) => {
      env.reply = async (ref, request, options) => {
        calls.push({ ref, request, options });
        return answer(request, options);
      };
    };
    // A reply that is made; a dry run has no reply yet.
    const made =
      (reply: string, target: ReplyTarget, state: 'pending' | 'posted'): Answer =>
      (_request, options) => ({
        action: 'created',
        dryRun: options.dryRun,
        state,
        ...(options.dryRun ? {} : { comment: reply, url: urlOf(reply) }),
        target,
      });
    const identical =
      (reply: string, target: ReplyTarget): Answer =>
      (_request, options) => ({
        action: 'unchanged',
        dryRun: options.dryRun,
        state: 'pending',
        comment: reply,
        url: urlOf(reply),
        target,
        message: 'an identical reply of yours already exists',
      });
    const refused =
      (message: string, target?: ReplyTarget): Answer =>
      (_request, options) => ({ action: 'error', dryRun: options.dryRun, ...(target ? { target } : {}), message });
    const reply = (...args: string[]) => step('link', 'reply', '--db', review, ...args);

    beforeEach(async () => {
      calls = [];
      refreshes = 0;
      env.getPullRequest = async () => {
        refreshes += 1;
        return withComments('r546201', 'c624100');
      };
      await step('link', 'own', 'F1', 'r1001');
      await step('link', 'duplicate', 'F1', 'r1004');
      await step('link', 'duplicate', 'F1', 'c2001');
    });

    it('answers the duplicate for the pull request of the review, prints the result and what it answers, and records the reply', async () => {
      engine(made('r546201', THREAD, 'pending'));
      const links = (await loaded()).links;

      expect(await reply('r1004')).toBe(0);

      expect(printed).toBe(`created    pending  r546201  docs/readme.md:7  ${urlOf('r546201')}\nanswers r1004 (carol, thread open)\n`);
      expect(warned).toBe(line());
      expect(calls).toMatchObject([{ ref: PR_REF, request: { commentRef: 'r1004', body: TEXT, requires: { ref: 'r1001' } }, options: { now: false, dryRun: false } }]);
      expect(refreshes).toBe(1);
      expect((await updatesOf('F1'))?.at(-1)).toBe(
        `${STAMP} — replied to duplicate [r1004](https://ghe.example.com/acme/widgets/pull/157#discussion_r1004) with ` +
          '[r546201](https://ghe.example.com/acme/widgets/pull/157#discussion_r546201) in the pending review',
      );
      expect((await loaded()).links).toEqual(links);
      expect((await loadSnapshot(review))?.comments.map(({ url: commentUrl }) => commentUrl)).toContain(urlOf('r546201'));
    });

    it('shows the thread as resolved, the path alone for a file-level thread, and conversation for a conversation comment', async () => {
      engine(made('r546201', { ...THREAD, resolved: true }, 'pending'));
      await reply('r1004');
      expect(printed).toBe(`created    pending  r546201  docs/readme.md:7  ${urlOf('r546201')}\nanswers r1004 (carol, thread resolved)\n`);

      engine(made('r546201', { ...THREAD, lines: undefined }, 'pending'));
      await reply('r1004');
      expect(printed).toBe(`created    pending  r546201  docs/readme.md  ${urlOf('r546201')}\nanswers r1004 (carol, thread open)\n`);

      engine(made('c624100', CONVERSATION, 'posted'));
      await reply('c2001', '--now');
      expect(printed).toBe(`created    posted   c624100  conversation  ${urlOf('c624100')}\nanswers c2001 (alice)\n`);
    });

    it('passes --now and --by-agent on, and logs a posted answer without the pending review', async () => {
      engine(made('c624100', CONVERSATION, 'posted'));

      expect(await reply('c2001', '--now', '--by-agent')).toBe(0);

      expect(calls).toMatchObject([{ ref: PR_REF, request: { commentRef: 'c2001', body: WITH_DISCLAIMER }, options: { now: true, dryRun: false } }]);
      expect(warned).toBe(line());
      expect((await updatesOf('F1'))?.at(-1)).toBe(`${STAMP} — replied to duplicate ${LINKED.c2001} with ${LINKED.c624100}`);
    });

    it('reports an identical reply as unchanged, records it once, and still names the database', async () => {
      engine(identical('r546201', THREAD));

      expect(await reply('r1004')).toBe(0);

      const text = `unchanged  pending  r546201  docs/readme.md:7  ${urlOf('r546201')}  an identical reply of yours already exists\nanswers r1004 (carol, thread open)\n`;
      expect(printed).toBe(text);
      expect(warned).toBe(line());
      const recorded = await updatesOf('F1');
      expect(recorded?.at(-1)).toBe(`${STAMP} — replied to duplicate ${LINKED.r1004} with ${LINKED.r546201} in the pending review`);

      expect(await reply('r1004')).toBe(0);
      expect(printed).toBe(text);
      expect(await updatesOf('F1')).toEqual(recorded);
    });

    it('prints an error result with the answered comment when it is known, exits with 1, records nothing and names no database', async () => {
      const before = await bytes();

      engine(refused('GitHub rejected the reply (is the thread still there?)'));
      expect(await reply('r1004')).toBe(1);
      expect(printed).toBe(`${'error'.padEnd(9)}  ${''.padEnd('pending'.length)}  -  GitHub rejected the reply (is the thread still there?)\n`);

      engine(refused(NEEDS_NOW, CONVERSATION));
      expect(await reply('c2001')).toBe(1);
      expect(printed).toBe(`${'error'.padEnd(9)}  ${''.padEnd('pending'.length)}  -  ${NEEDS_NOW}\nanswers c2001 (alice)\n`);

      expect(warned).toBe('');
      expect(refreshes).toBe(0);
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('with --dry-run prints what would happen and the exact text, writes nothing, downloads nothing and names no database', async () => {
      engine(made('r546201', THREAD, 'pending'));
      const before = await bytes();

      expect(await reply('r1004', '--dry-run', '--by-agent')).toBe(0);

      const label = 'would create'.padEnd('would leave unchanged'.length);
      expect(printed).toBe(
        [`${label}  pending  -  docs/readme.md:7`, 'answers r1004 (carol, thread open)', '----- reply text -----', WITH_DISCLAIMER, '-----', ''].join('\n'),
      );
      expect(calls).toMatchObject([{ request: { commentRef: 'r1004', body: WITH_DISCLAIMER }, options: { now: false, dryRun: true } }]);
      expect(warned).toBe('');
      expect(refreshes).toBe(0);
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('prints the object of the reply as JSON with --json, and exits with 1 for an error result', async () => {
      engine(made('r546201', THREAD, 'pending'));

      expect(await reply('r1004', '--json', '--by-agent')).toBe(0);

      const result = { action: 'created', dryRun: false, state: 'pending', comment: 'r546201', url: urlOf('r546201'), target: THREAD };
      expect(printed).toBe(`${JSON.stringify({ finding: 'F1', own: 'r1001', link: OWN_LINK, text: WITH_DISCLAIMER, result }, null, 2)}\n`);
      expect(warned).toBe(line());

      engine(refused('GitHub rejected the reply', THREAD));
      expect(await reply('r1004', '--json')).toBe(1);
      expect(JSON.parse(printed)).toMatchObject({ finding: 'F1', own: 'r1001', result: { action: 'error', message: 'GitHub rejected the reply' } });
      expect(warned).toBe('');
    });

    it('turns a pull request that cannot be refreshed into an error result, and records nothing', async () => {
      engine(made('r546201', THREAD, 'pending'));
      env.getPullRequest = async () => {
        throw new Error('GitHub is down');
      };
      const before = await bytes();

      expect(await reply('r1004')).toBe(1);

      expect(printed).toContain('the reply was posted as r546201, but the pull request could not be refreshed (GitHub is down)');
      expect(warned).toBe('');
      expect((await bytes()).equals(before)).toBe(true);
    });

    it('lets the refusals of the review through before it asks GitHub for anything, and changes nothing', async () => {
      engine(made('r546201', THREAD, 'pending'));

      await fails(['link', 'reply', 'r999', '--db', review], 'r999 is not linked in this review');
      await fails(['link', 'reply', 'r1001', '--db', review], 'r1001 is linked as the own comment of F1, not as a duplicate');
      await fails(['link', 'reply', COMPLEXITY_REF, '--db', review], `${COMPLEXITY_REF} is a check annotation; there is nothing to reply to`);
      await step('link', 'note', 'r1003', 'a remark');
      await fails(['link', 'reply', 'r1003', '--db', review], 'r1003 is recorded as a note, not as a duplicate of a finding');
      expect(calls).toEqual([]);
    });
  });
});
