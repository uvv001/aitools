import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolveRevision } from './git-revision.ts';

const NOT_A_REPOSITORY = 'not inside a git repository (run the command in the reviewed repository)';
const EIGHT_HEX = /^[0-9a-f]{8}$/u;

// Real repositories under the git-ignored out/, each with a repository of its own inside the one of the project.
const out = join(import.meta.dirname, '..', 'out');
let work = '';

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}

function initRepository(name: string): string {
  const repository = join(work, name);
  mkdirSync(repository);
  git(repository, ['init', '-q', '-b', 'main']);
  git(repository, ['config', 'user.name', 'Test Author']);
  git(repository, ['config', 'user.email', 'test@example.com']);
  git(repository, ['config', 'commit.gpgsign', 'false']);
  git(repository, ['config', 'tag.gpgsign', 'false']);
  return repository;
}

const commit = (repository: string, message: string): string => {
  git(repository, ['commit', '-q', '--allow-empty', '-m', message]);
  return git(repository, ['rev-parse', 'HEAD']);
};

beforeAll(() => {
  mkdirSync(out, { recursive: true });
  work = mkdtempSync(join(out, 'git-revision-'));
});

afterAll(() => {
  rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('resolveRevision in a repository', () => {
  let repository = '';
  const hashes: string[] = [];

  // main: first <- second <- third (HEAD); feature at second; tags v1 (first, lightweight) and v2 (second, annotated).
  beforeAll(() => {
    repository = initRepository('history');
    hashes.push(commit(repository, 'first'));
    git(repository, ['tag', 'v1']);
    hashes.push(commit(repository, 'second'));
    git(repository, ['tag', '-a', 'v2', '-m', 'the second']);
    git(repository, ['branch', 'feature']);
    hashes.push(commit(repository, 'third'));
  });

  const short = (hash: string): string => hash.slice(0, 8);

  it('resolves HEAD to the 8 lower-case hex digits of its commit', async () => {
    const head = await resolveRevision('HEAD', repository);
    expect(head).toMatch(EIGHT_HEX);
    expect(head).toBe(short(hashes[2]!));
  });

  it('resolves a branch, a lightweight tag and an annotated tag to the commit they name', async () => {
    expect(await resolveRevision('main', repository)).toBe(short(hashes[2]!));
    expect(await resolveRevision('feature', repository)).toBe(short(hashes[1]!));
    expect(await resolveRevision('v1', repository)).toBe(short(hashes[0]!));
    expect(await resolveRevision('v2', repository)).toBe(short(hashes[1]!));
  });

  it('resolves a full hash, an abbreviation of any length from 4 and the same in capitals', async () => {
    const full = hashes[1]!;
    for (const spelling of [full, full.slice(0, 12), full.slice(0, 8), full.slice(0, 7), full.slice(0, 4), full.toUpperCase(), full.slice(0, 7).toUpperCase()]) {
      expect(await resolveRevision(spelling, repository)).toBe(short(full));
    }
  });

  it('resolves expressions relative to a commit', async () => {
    expect(await resolveRevision('HEAD~1', repository)).toBe(short(hashes[1]!));
    expect(await resolveRevision('HEAD^', repository)).toBe(short(hashes[1]!));
    expect(await resolveRevision('HEAD~2', repository)).toBe(short(hashes[0]!));
    expect(await resolveRevision('main~1', repository)).toBe(short(hashes[1]!));
    expect(await resolveRevision('feature^', repository)).toBe(short(hashes[0]!));
    expect(await resolveRevision('v2^{commit}', repository)).toBe(short(hashes[1]!));
    expect(await resolveRevision('HEAD~0', repository)).toBe(short(hashes[2]!));
    expect(await resolveRevision(git(repository, ['merge-base', 'main', 'feature']), repository)).toBe(short(hashes[1]!));
  });

  it('gives the same 8 characters for every spelling of the same commit', async () => {
    const spellings = ['feature', 'v2', 'HEAD~1', 'main~1', 'HEAD^', hashes[1]!, hashes[1]!.slice(0, 7), hashes[1]!.slice(0, 40).toUpperCase()];
    const results = await Promise.all(spellings.map((spelling) => resolveRevision(spelling, repository)));
    expect(new Set(results)).toStrictEqual(new Set([short(hashes[1]!)]));
    for (const result of results) expect(result).toMatch(EIGHT_HEX);
  });

  it('works from a folder inside the repository', async () => {
    const folder = join(repository, 'src', 'deep');
    mkdirSync(folder, { recursive: true });
    expect(await resolveRevision('HEAD', folder)).toBe(short(hashes[2]!));
  });

  it('refuses a name that does not exist in the repository', async () => {
    await expect(resolveRevision('nope', repository)).rejects.toThrow(new Error('revision "nope" does not exist in this repository'));
    await expect(resolveRevision('HEAD~9', repository)).rejects.toThrow(new Error('revision "HEAD~9" does not exist in this repository'));
    await expect(resolveRevision('0000000', repository)).rejects.toThrow(new Error('revision "0000000" does not exist in this repository'));
  });

  it('refuses a revision that starts with a dash, whichever the folder: git is never asked', async () => {
    for (const revision of ['-x', '--all', '--end-of-options', '-', '--short=4']) {
      const message = `revision "${revision}" is not a valid revision`;
      await expect(resolveRevision(revision, repository)).rejects.toThrow(new Error(message));
      await expect(resolveRevision(revision, join(work, 'missing'))).rejects.toThrow(new Error(message));
    }
  });

  it('refuses an empty revision and one with a control character', async () => {
    for (const revision of ['', ' ', '\t']) {
      await expect(resolveRevision(revision, repository)).rejects.toThrow(new Error('revision is empty'));
    }
    for (const revision of ['HEAD\n', 'HE\u0000AD', 'a\rb']) {
      await expect(resolveRevision(revision, repository)).rejects.toThrow(new Error(`revision "${revision}" is not a valid revision`));
    }
  });

  it('refuses a revision that names something else than a commit', async () => {
    await expect(resolveRevision('HEAD^{tree}', repository)).rejects.toThrow(new Error('revision "HEAD^{tree}" is not a commit'));
  });
});

describe('resolveRevision in a repository without commits', () => {
  it('does not know HEAD yet', async () => {
    const repository = initRepository('empty');
    await expect(resolveRevision('HEAD', repository)).rejects.toThrow(new Error('revision "HEAD" does not exist in this repository'));
  });
});

describe('resolveRevision with an ambiguous abbreviation', () => {
  // Two commits whose hashes start with the same four digits, found by trying commit texts until two collide.
  it('names the abbreviation and asks for a longer one, while the full hashes still work', async () => {
    const repository = initRepository('ambiguous');
    commit(repository, 'base');
    const tree = git(repository, ['rev-parse', 'HEAD^{tree}']);
    const seen = new Map<string, { body: string; id: string }>();
    let pair: [{ body: string; id: string }, { body: string; id: string }] | undefined;
    for (let number = 0; pair === undefined; number++) {
      const stamp = `${1700000000 + number} +0000`;
      const body = `tree ${tree}\nauthor A <a@example.com> ${stamp}\ncommitter A <a@example.com> ${stamp}\n\nm${number}\n`;
      const id = createHash('sha1').update(`commit ${Buffer.byteLength(body)}\0${body}`).digest('hex');
      const earlier = seen.get(id.slice(0, 4));
      if (earlier === undefined) seen.set(id.slice(0, 4), { body, id });
      else pair = [earlier, { body, id }];
    }
    for (const { body, id } of pair) expect(git(repository, ['hash-object', '-t', 'commit', '-w', '--stdin'], body)).toBe(id);
    const [one, other] = pair;
    const prefix = one.id.slice(0, 4);
    await expect(resolveRevision(prefix, repository)).rejects.toThrow(
      new Error(`revision "${prefix}" is ambiguous in this repository; use a longer abbreviation`),
    );
    expect(await resolveRevision(one.id.slice(0, 7), repository)).toBe(one.id.slice(0, 8));
    expect(await resolveRevision(other.id, repository)).toBe(other.id.slice(0, 8));
  });
});

describe('resolveRevision outside a repository', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('says so', async (context) => {
    const folder = join(work, 'plain');
    mkdirSync(folder);
    // The project's own repository is above out/: git must not climb into the folder that holds `plain`.
    vi.stubEnv('GIT_CEILING_DIRECTORIES', work);
    const insideRepository = ((): boolean => {
      try {
        git(folder, ['rev-parse', '--git-dir']);
        return true;
      } catch {
        return false;
      }
    })();
    if (insideRepository) context.skip('a git repository was found above the scratch folder, so "not a repository" cannot be set up here');
    await expect(resolveRevision('HEAD', folder)).rejects.toThrow(new Error(NOT_A_REPOSITORY));
    await expect(resolveRevision('main', folder)).rejects.toThrow(new Error(NOT_A_REPOSITORY));
  });

  it('checks the revision before the repository', async () => {
    await expect(resolveRevision('-x', work)).rejects.toThrow(new Error('revision "-x" is not a valid revision'));
    await expect(resolveRevision('', work)).rejects.toThrow(new Error('revision is empty'));
  });
});
