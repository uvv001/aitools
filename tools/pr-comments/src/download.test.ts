import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccessDeniedError } from './github.ts';
import { downloadPullRequest, withWorkingToken } from './download.ts';
import { tokenFilePath } from './token.ts';
import { tokenMemoPath } from './token-memo.ts';

const ref = { host: 'ghe.example.com', owner: 'Acme', repo: 'widgets', number: 5 };
const ownerScope = { host: ref.host, owner: ref.owner };
const hostScope = { host: ref.host };

const prNode = {
  id: 'PR_1',
  title: 'Add widgets',
  body: '',
  state: 'OPEN',
  url: 'https://ghe.example.com/acme/widgets/pull/5',
  createdAt: '2026-01-01T09:00:00Z',
  author: { login: 'alice' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: 'headsha',
};
const emptyPage = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

const sonarSuite = {
  id: 'CS_1',
  app: { name: 'SonarQube', slug: 'sq-community-pr-decoration' },
  checkRuns: {
    nodes: [
      {
        id: 'CR_1',
        databaseId: 4001,
        name: 'SonarQube Code Analysis',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        detailsUrl: 'https://sonar.example.com/dashboard',
        annotations: {
          nodes: [
            {
              path: 'src/a.ts',
              annotationLevel: 'FAILURE',
              title: 'src/a.ts#L3',
              message: 'Fix this.',
              rawDetails: null,
              location: { start: { line: 3 }, end: { line: 3 } },
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
};

// The "checks-" behaviors read the pull request fine and fail on the check runs only.
type Behavior = 'ok' | 'not-found' | 'unauthorized' | 'server-error' | 'checks-denied' | 'checks-error';

function fakeFetch(behaviors: Record<string, Behavior>, calls: string[]): typeof fetch {
  return (async (_url: string, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).Authorization!.replace('Bearer ', '');
    calls.push(token);
    switch (behaviors[token]) {
      case 'unauthorized':
        return new Response('no', { status: 401, statusText: 'Unauthorized' });
      case 'server-error':
        return new Response('no', { status: 502, statusText: 'Bad Gateway' });
      case 'not-found':
        return Response.json({
          errors: [{ type: 'NOT_FOUND', message: "Could not resolve to a Repository with the name 'Acme/widgets'." }],
        });
    }
    const { query } = JSON.parse(init.body as string) as { query: string };
    if (query.includes('headRefOid')) return Response.json({ data: { repository: { pullRequest: prNode } } });
    if (query.includes('checkSuites(first')) {
      if (behaviors[token] === 'checks-denied') return new Response('no', { status: 403, statusText: 'Forbidden' });
      if (behaviors[token] === 'checks-error') return new Response('no', { status: 502, statusText: 'Bad Gateway' });
      const commit = { oid: 'headsha', checkSuites: { nodes: [sonarSuite], pageInfo: emptyPage.pageInfo } };
      return Response.json({ data: { repository: { pullRequest: { commits: { nodes: [{ commit }] } } } } });
    }
    const connection = ['reviewThreads', 'reviews', 'comments'].find((name) => query.includes(`${name}(first`))!;
    return Response.json({ data: { repository: { pullRequest: { [connection]: emptyPage } } } });
  }) as typeof fetch;
}

describe('downloadPullRequest', () => {
  let home: string;
  let calls: string[];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pr-comments-download-'));
    calls = [];
    await mkdir(join(home, '.config', 'tokens'), { recursive: true });
    await writeFile(tokenFilePath(ownerScope, home), 'owner-token');
    await writeFile(tokenFilePath(hostScope, home), 'host-token');
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const download = (behaviors: Record<string, Behavior>) => {
    calls = [];
    return downloadPullRequest(ref, { env: {}, home, fetchImpl: fakeFetch(behaviors, calls), now: () => new Date(0) });
  };
  const tried = () => [...new Set(calls)];
  const memo = async () => JSON.parse(await readFile(tokenMemoPath(home), 'utf8')) as Record<string, string>;

  it('uses the most specific token first and remembers it', async () => {
    const data = await download({ 'owner-token': 'ok', 'host-token': 'ok' });
    expect(data.pullRequest.title).toBe('Add widgets');
    expect(tried()).toEqual(['owner-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com_Acme' });
  });

  it('moves on to the next token when one cannot see the pull request, and remembers the one that worked', async () => {
    const data = await download({ 'owner-token': 'not-found', 'host-token': 'ok' });
    expect(data.pullRequest.title).toBe('Add widgets');
    expect(tried()).toEqual(['owner-token', 'host-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com' });

    await download({ 'owner-token': 'not-found', 'host-token': 'ok' });
    expect(tried()).toEqual(['host-token']);
  });

  it('also moves on after an unauthorized response', async () => {
    await download({ 'owner-token': 'unauthorized', 'host-token': 'ok' });
    expect(tried()).toEqual(['owner-token', 'host-token']);
  });

  it('tries the others again, and updates the memo, when the remembered token stops working', async () => {
    await download({ 'owner-token': 'not-found', 'host-token': 'ok' });

    await download({ 'owner-token': 'ok', 'host-token': 'not-found' });
    expect(tried()).toEqual(['host-token', 'owner-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com_Acme' });
  });

  it('reads the check runs with annotations of the head commit, which only the download does', async () => {
    const data = await download({ 'owner-token': 'ok' });
    expect(data.checkRuns!.map((r) => [r.id, r.name, r.app, r.headSha, r.annotations.map((a) => [a.path, a.startLine, a.level])])).toEqual([
      [4001, 'SonarQube Code Analysis', 'sq-community-pr-decoration', 'headsha', [['src/a.ts', 3, 'failure']]],
    ]);
  });

  it('moves on to the next token when one cannot read the check runs', async () => {
    const data = await download({ 'owner-token': 'checks-denied', 'host-token': 'ok' });
    expect(data.checkRuns).toHaveLength(1);
    expect(tried()).toEqual(['owner-token', 'host-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com' });
  });

  it('does not move on after a failure of the check runs that is not about access, and says what failed', async () => {
    await expect(download({ 'owner-token': 'checks-error', 'host-token': 'ok' })).rejects.toThrow(
      'reading the check runs failed: GitHub API request failed: 502 Bad Gateway',
    );
    expect(tried()).toEqual(['owner-token']);
  });

  it('does not move on after a failure that is not about access', async () => {
    await expect(download({ 'owner-token': 'server-error', 'host-token': 'ok' })).rejects.toThrow('502 Bad Gateway');
    expect(tried()).toEqual(['owner-token']);
  });

  it('lists every token source it tried, never the tokens themselves', async () => {
    const error = await download({ 'owner-token': 'not-found', 'host-token': 'unauthorized' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AccessDeniedError);
    const { message } = error as Error;
    expect(message).toContain(tokenFilePath(ownerScope, home));
    expect(message).toContain(tokenFilePath(hostScope, home));
    expect(message).not.toContain('owner-token');
    expect(message).not.toContain('host-token');
  });

  it('works when the memo is corrupt or names a token that no longer exists', async () => {
    await mkdir(join(home, '.cache', 'pr-comments'), { recursive: true });

    await writeFile(tokenMemoPath(home), 'not json');
    await download({ 'owner-token': 'ok' });
    expect(tried()).toEqual(['owner-token']);

    await writeFile(tokenMemoPath(home), JSON.stringify({ token_source: 'file:gone' }));
    await download({ 'owner-token': 'ok' });
    expect(tried()).toEqual(['owner-token']);
  });

  it('still downloads when the memo cannot be written', async () => {
    await writeFile(join(home, '.cache'), 'a file where the cache folder should be');
    const data = await download({ 'owner-token': 'ok' });
    expect(data.pullRequest.title).toBe('Add widgets');
  });
});

describe('withWorkingToken', () => {
  let home: string;
  let seen: string[];

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pr-comments-token-loop-'));
    seen = [];
    await mkdir(join(home, '.config', 'tokens'), { recursive: true });
    await writeFile(tokenFilePath(ownerScope, home), 'owner-token');
    await writeFile(tokenFilePath(hostScope, home), 'host-token');
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  // Refused for every token except `accepted`.
  const run = (accepted: string) =>
    withWorkingToken(
      ownerScope,
      async ({ token }) => {
        seen.push(token);
        if (token !== accepted) throw new AccessDeniedError('refused');
        return token;
      },
      { env: {}, home },
    );
  const memo = async () => JSON.parse(await readFile(tokenMemoPath(home), 'utf8')) as Record<string, string>;

  it('hands the operation the token, the host, the fetch and a client that uses them', async () => {
    const requests: { url: string; authorization: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      requests.push({ url, authorization: (init.headers as Record<string, string>).Authorization! });
      return Response.json({ data: { answer: 42 } });
    }) as typeof fetch;

    const result = await withWorkingToken(
      ownerScope,
      async (context) => ({ context, data: await context.client<{ answer: number }>('query', {}) }),
      { env: {}, home, fetchImpl },
    );

    expect(result.data).toEqual({ answer: 42 });
    expect(result.context).toMatchObject({ token: 'owner-token', host: ref.host, fetchImpl });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe('https://ghe.example.com/api/graphql');
    expect(requests[0]!.authorization).toContain('owner-token');
  });

  it('moves on after an access error and remembers the token that worked', async () => {
    expect(await run('host-token')).toBe('host-token');
    expect(seen).toEqual(['owner-token', 'host-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com' });
  });

  it('stops at an error that is not about access and remembers nothing', async () => {
    const failing = withWorkingToken(
      ownerScope,
      async ({ token }) => {
        seen.push(token);
        throw new Error('boom');
      },
      { env: {}, home },
    );

    await expect(failing).rejects.toThrow('boom');
    expect(seen).toEqual(['owner-token']);
    await expect(memo()).rejects.toThrow();
  });

  it('switches to a write-capable token when a later operation is refused by a remembered read-only token', async () => {
    await run('owner-token');
    expect(seen).toEqual(['owner-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com_Acme' });

    seen = [];
    await run('host-token');
    expect(seen).toEqual(['owner-token', 'host-token']);
    expect(await memo()).toEqual({ token_source: 'file:ghe.example.com' });

    seen = [];
    await run('host-token');
    expect(seen).toEqual(['host-token']);
  });

  it('lists every token source it tried, never the tokens themselves, when all are refused', async () => {
    const error = await run('none').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AccessDeniedError);
    expect((error as Error).message).toBe(
      `refused; tokens tried: ${tokenFilePath(ownerScope, home)}, ${tokenFilePath(hostScope, home)}`,
    );
    expect((error as Error).message).not.toMatch(/owner-token|host-token/);
  });
});
