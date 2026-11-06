import { describe, expect, it, vi } from 'vitest';
import { annotationRef } from './comment-ref.ts';
import { AccessDeniedError, createGraphQLClient, fetchPullRequest, graphqlEndpoint, type GraphQLClient } from './github.ts';

const ref = { host: 'ghe.example.com', owner: 'acme', repo: 'widgets', number: 5 };

const page = <T>(nodes: (T | null)[], endCursor: string | null = null) => ({
  nodes,
  pageInfo: { hasNextPage: endCursor !== null, endCursor },
});

const issueComment = (id: string, login: string | null = 'alice') => ({
  id,
  body: `body ${id}`,
  createdAt: '2026-01-01T10:00:00Z',
  updatedAt: '2026-01-01T10:00:00Z',
  lastEditedAt: null as string | null,
  url: `https://ghe.example.com/c/${id}`,
  author: login ? { login } : null,
});

const reviewComment = (id: string, replyTo: string | null = null) => ({
  id,
  body: `body ${id}`,
  createdAt: '2026-01-02T10:00:00Z',
  updatedAt: '2026-01-02T10:00:00Z',
  lastEditedAt: null as string | null,
  url: `https://ghe.example.com/rc/${id}`,
  diffHunk: '@@ -1 +1 @@\n-old\n+new',
  author: { login: 'bob' },
  commit: { oid: 'cccc' },
  originalCommit: { oid: 'oooo' },
  replyTo: replyTo ? { id: replyTo } : null,
  pullRequestReview: { id: 'review-1' },
});

const thread = (id: string, comments: ReturnType<typeof page>, originalStartLine: number | null = null) => ({
  id,
  path: 'src/a.ts',
  line: 10,
  originalLine: 8,
  startLine: null,
  originalStartLine,
  isResolved: false,
  isOutdated: true,
  comments,
});

interface Responses {
  pullRequest?: unknown;
  issueComments?: ReturnType<typeof page>[];
  reviews?: ReturnType<typeof page>[];
  threads?: ReturnType<typeof page>[];
  threadComments?: Record<string, ReturnType<typeof page>[]>;
}

function fakeClient(responses: Responses): { client: GraphQLClient; calls: Record<string, unknown>[] } {
  const calls: Record<string, unknown>[] = [];
  const counters: Record<string, number> = {};
  const next = <T>(key: string, pages: T[]) => pages[counters[key] = (counters[key] ?? -1) + 1]!;
  const wrap = (connection: string, value: unknown) => ({ repository: { pullRequest: { [connection]: value } } });

  const client: GraphQLClient = async <T>(query: string, variables: Record<string, unknown>) => {
    calls.push(variables);
    if (query.includes('node(id: $id)')) {
      return { node: { comments: next(`tc:${variables.id}`, responses.threadComments![variables.id as string]!) } } as T;
    }
    if (query.includes('reviewThreads(first')) return wrap('reviewThreads', next('threads', responses.threads ?? [page([])])) as T;
    if (query.includes('reviews(first')) return wrap('reviews', next('reviews', responses.reviews ?? [page([])])) as T;
    if (query.includes('comments(first') && !query.includes('reviewThreads')) {
      return wrap('comments', next('issue', responses.issueComments ?? [page([])])) as T;
    }
    return { repository: { pullRequest: responses.pullRequest } } as T;
  };
  return { client, calls };
}

const prNode = {
  id: 'PR_1',
  title: 'Add widgets',
  body: 'Description',
  state: 'OPEN',
  url: 'https://ghe.example.com/acme/widgets/pull/5',
  createdAt: '2026-01-01T09:00:00Z',
  author: { login: 'alice' },
  baseRefName: 'main',
  headRefName: 'feature',
  headRefOid: 'headsha',
};

describe('fetchPullRequest', () => {
  it('maps pull request metadata and stamps the time the download started', async () => {
    const { client } = fakeClient({ pullRequest: prNode });
    const { pullRequest } = await fetchPullRequest(client, ref, () => new Date('2026-02-03T04:05:06.789Z'));
    expect(pullRequest).toEqual({
      id: 'PR_1',
      host: 'ghe.example.com',
      owner: 'acme',
      repo: 'widgets',
      number: 5,
      title: 'Add widgets',
      body: 'Description',
      state: 'OPEN',
      author: 'alice',
      baseRef: 'main',
      headRef: 'feature',
      headSha: 'headsha',
      url: 'https://ghe.example.com/acme/widgets/pull/5',
      createdAt: '2026-01-01T09:00:00Z',
      fetchedAt: '2026-02-03T04:05:06Z',
    });
  });

  it('fails clearly when the pull request is missing', async () => {
    const { client } = fakeClient({ pullRequest: null });
    await expect(fetchPullRequest(client, ref)).rejects.toThrow(/acme\/widgets#5 was not found/);
  });

  it('explains an inaccessible repository instead of the raw GraphQL error', async () => {
    const client: GraphQLClient = async () => {
      throw new Error("GitHub GraphQL errors: Could not resolve to a Repository with the name 'acme/widgets'.");
    };
    await expect(fetchPullRequest(client, ref)).rejects.toThrow(/was not found or the token cannot access it/);
  });

  it('passes other API errors through unchanged', async () => {
    const client: GraphQLClient = async () => {
      throw new Error('GitHub API request failed: 502 Bad Gateway');
    };
    await expect(fetchPullRequest(client, ref)).rejects.toThrow('502 Bad Gateway');
  });

  it('follows pagination of issue comments and attributes deleted users to ghost', async () => {
    const { client, calls } = fakeClient({
      pullRequest: prNode,
      issueComments: [page([issueComment('i1'), null], 'cursor-1'), page([issueComment('i2', null)])],
    });
    const { comments } = await fetchPullRequest(client, ref);
    expect(comments.map((c) => [c.id, c.author, c.kind])).toEqual([
      ['i1', 'alice', 'issue'],
      ['i2', 'ghost', 'issue'],
    ]);
    expect(calls.some((c) => c.after === 'cursor-1')).toBe(true);
  });

  it('maps reviews', async () => {
    const { client } = fakeClient({
      pullRequest: prNode,
      reviews: [
        page([
          {
            id: 'rev1',
            state: 'CHANGES_REQUESTED',
            body: 'Please fix',
            submittedAt: '2026-01-03T10:00:00Z',
            lastEditedAt: '2026-01-03T11:00:00Z',
            url: 'https://ghe.example.com/r/rev1',
            author: { login: 'carol' },
            commit: { oid: 'revsha' },
          },
        ]),
      ],
    });
    const { reviews } = await fetchPullRequest(client, ref);
    expect(reviews).toEqual([
      {
        id: 'rev1',
        author: 'carol',
        state: 'CHANGES_REQUESTED',
        body: 'Please fix',
        submittedAt: '2026-01-03T10:00:00Z',
        editedAt: '2026-01-03T11:00:00Z',
        commitSha: 'revsha',
        url: 'https://ghe.example.com/r/rev1',
      },
    ]);
  });

  it('takes the edit time from lastEditedAt, not from updatedAt', async () => {
    const edited = { ...issueComment('i1'), updatedAt: '2026-01-09T10:00:00Z', lastEditedAt: '2026-01-05T10:00:00Z' };
    const untouched = { ...issueComment('i2'), updatedAt: '2026-01-09T10:00:00Z' };
    const editedReply = { ...reviewComment('rc1'), lastEditedAt: '2026-01-06T10:00:00Z' };
    const { client } = fakeClient({
      pullRequest: prNode,
      issueComments: [page([edited, untouched])],
      threads: [page([thread('t1', page([editedReply, reviewComment('rc2')]))])],
    });
    const { comments } = await fetchPullRequest(client, ref);
    expect(comments.map((c) => [c.id, c.editedAt])).toEqual([
      ['i1', '2026-01-05T10:00:00Z'],
      ['i2', null],
      ['rc1', '2026-01-06T10:00:00Z'],
      ['rc2', null],
    ]);
  });

  it('keeps thread order, replies, code context and commits, including comments beyond the first page', async () => {
    const { client } = fakeClient({
      pullRequest: prNode,
      threads: [
        page([
          thread('t1', page([reviewComment('rc1'), reviewComment('rc2', 'rc1')], 'thread-cursor'), 5),
          thread('t2', page([reviewComment('rc4')])),
        ]),
      ],
      threadComments: { t1: [page([reviewComment('rc3', 'rc1')])] },
    });
    const { threads, comments } = await fetchPullRequest(client, ref);

    expect(threads).toEqual([
      { id: 't1', path: 'src/a.ts', line: 10, originalLine: 8, startLine: null, originalStartLine: 5, isResolved: false, isOutdated: true },
      { id: 't2', path: 'src/a.ts', line: 10, originalLine: 8, startLine: null, isResolved: false, isOutdated: true },
    ]);
    expect(comments.map((c) => [c.id, c.threadId, c.threadPosition, c.replyToId])).toEqual([
      ['rc1', 't1', 0, null],
      ['rc2', 't1', 1, 'rc1'],
      ['rc3', 't1', 2, 'rc1'],
      ['rc4', 't2', 0, null],
    ]);
    expect(comments[0]).toMatchObject({
      kind: 'review',
      reviewId: 'review-1',
      author: 'bob',
      commitSha: 'cccc',
      originalCommitSha: 'oooo',
      diffHunk: '@@ -1 +1 @@\n-old\n+new',
    });
  });
});

type Page = ReturnType<typeof page>;

// Pages of nodes whose cursors are "c1", "c2" ...; the fake client below picks the page the `after` cursor points at.
const pages = (...chunks: unknown[][]): Page[] => chunks.map((nodes, i) => page(nodes, i < chunks.length - 1 ? `c${i + 1}` : null));
const pick = (all: Page[], after: unknown): Page => all[after === null ? 0 : Number(String(after).slice(1))]!;

const annotation = (path: string, line: number, level: string | null = 'WARNING', extra: Record<string, unknown> = {}) => ({
  path,
  annotationLevel: level,
  title: `${path}#L${line}`,
  message: `message ${path}:${line}`,
  rawDetails: null,
  location: { start: { line }, end: { line } },
  ...extra,
});

const checkRunNode = (id: number, name: string, annotations: Page) => ({
  id: `CR_${id}`,
  databaseId: id,
  name,
  status: 'COMPLETED',
  conclusion: 'FAILURE',
  detailsUrl: `https://ghe.example.com/runs/${id}`,
  annotations,
});

const checkSuiteNode = (id: string, app: { name: string; slug: string } | null, checkRuns: Page) => ({ id, app, checkRuns });

const sonarApp = { name: 'SonarQube', slug: 'sq-community-pr-decoration' };

interface Checks {
  oid?: string;
  suites: Page[];
  // Further pages of the runs of a suite, and of the annotations of a run, by node id.
  runs?: Record<string, Page[]>;
  annotations?: Record<string, Page[]>;
  fail?: (kind: 'suites' | 'runs' | 'annotations') => Error | undefined;
}

function fakeChecksClient(checks: Checks, responses: Responses = { pullRequest: prNode }) {
  const { client: base } = fakeClient(responses);
  const calls: string[] = [];
  const client: GraphQLClient = async <T>(query: string, variables: Record<string, unknown>) => {
    const kind = query.includes('checkSuites(first')
      ? 'suites'
      : query.includes('... on CheckSuite')
        ? 'runs'
        : query.includes('... on CheckRun')
          ? 'annotations'
          : undefined;
    if (!kind) return base<T>(query, variables);
    calls.push(kind === 'suites' ? `suites ${variables.after}` : `${kind} ${variables.id} ${variables.after}`);
    const failure = checks.fail?.(kind);
    if (failure) throw failure;
    if (kind === 'suites') {
      const commit = { oid: checks.oid ?? 'commitoid', checkSuites: pick(checks.suites, variables.after) };
      return { repository: { pullRequest: { commits: { nodes: [{ commit }] } } } } as T;
    }
    const all = (kind === 'runs' ? checks.runs : checks.annotations)![variables.id as string]!;
    return { node: { [kind === 'runs' ? 'checkRuns' : 'annotations']: pick(all, variables.after) } } as T;
  };
  return { client, calls };
}

describe('fetchPullRequest with the check runs', () => {
  const sonarRun = (annotations: unknown[], id = 4001) => checkRunNode(id, 'SonarQube Code Analysis', page(annotations));

  it('reads no check query unless asked to', async () => {
    const checks: Checks = { suites: pages([checkSuiteNode('CS_1', sonarApp, page([sonarRun([annotation('a.ts', 1)])]))]) };
    for (const options of [undefined, {}, { withChecks: false }]) {
      const { client, calls } = fakeChecksClient(checks);
      const data = await fetchPullRequest(client, ref, undefined, options);
      expect(data.checkRuns).toBeUndefined();
      expect('checkRuns' in data).toBe(false);
      expect(calls).toEqual([]);
    }
  });

  it('reads the check runs of the head commit, with the level, lines, app and id of each annotation', async () => {
    const run = sonarRun([
      annotation('src/a.ts', 132, 'FAILURE', { rawDetails: 'details', location: { start: { line: 132 }, end: { line: 135 } } }),
      annotation('src/b.ts', 7, 'WARNING', { title: null }),
      annotation('src/c.ts', 9, 'NOTICE', { location: { start: { line: 9 }, end: null } }),
    ]);
    const { client, calls } = fakeChecksClient({ oid: 'commitoid', suites: pages([checkSuiteNode('CS_1', sonarApp, page([run]))]) });

    const { checkRuns } = await fetchPullRequest(client, ref, undefined, { withChecks: true });

    const app = 'sq-community-pr-decoration';
    expect(checkRuns).toEqual([
      {
        id: 4001,
        name: 'SonarQube Code Analysis',
        app,
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        headSha: 'commitoid',
        detailsUrl: 'https://ghe.example.com/runs/4001',
        annotations: [
          {
            ref: annotationRef(app, 'src/a.ts', 132, 135, 'message src/a.ts:132'),
            path: 'src/a.ts',
            startLine: 132,
            endLine: 135,
            level: 'failure',
            title: 'src/a.ts#L132',
            message: 'message src/a.ts:132',
            rawDetails: 'details',
          },
          {
            ref: annotationRef(app, 'src/b.ts', 7, 7, 'message src/b.ts:7'),
            path: 'src/b.ts',
            startLine: 7,
            endLine: 7,
            level: 'warning',
            title: null,
            message: 'message src/b.ts:7',
            rawDetails: null,
          },
          {
            ref: annotationRef(app, 'src/c.ts', 9, 9, 'message src/c.ts:9'),
            path: 'src/c.ts',
            startLine: 9,
            endLine: 9,
            level: 'notice',
            title: 'src/c.ts#L9',
            message: 'message src/c.ts:9',
            rawDetails: null,
          },
        ],
      },
    ]);
    expect(checkRuns![0]!.annotations.every((a) => /^a[0-9a-f]{8}$/.test(a.ref))).toBe(true);
    expect(calls).toEqual(['suites null']);
  });

  it('keeps the data of the other reads next to the check runs', async () => {
    const { client } = fakeChecksClient({ suites: pages([]) }, { pullRequest: prNode, issueComments: [page([issueComment('i1')])] });
    const data = await fetchPullRequest(client, ref, undefined, { withChecks: true });
    expect(data.pullRequest.headSha).toBe('headsha');
    expect(data.comments.map((c) => c.id)).toEqual(['i1']);
    expect(data.checkRuns).toEqual([]);
  });

  it('drops the check runs without annotations', async () => {
    const lint = checkRunNode(1, 'Commit-lint', page([]));
    const owners = checkRunNode(2, 'Codeowner-approvals', page([]));
    const suites = pages([
      checkSuiteNode('CS_1', { name: 'GitHub Actions', slug: 'github-actions' }, page([lint, owners])),
      checkSuiteNode('CS_2', sonarApp, page([sonarRun([annotation('a.ts', 1)], 3)])),
    ]);
    const { checkRuns } = await fetchPullRequest(fakeChecksClient({ suites }).client, ref, undefined, { withChecks: true });
    expect(checkRuns!.map((r) => r.name)).toEqual(['SonarQube Code Analysis']);
  });

  it('names the app by its slug, else by its lower-cased name, else "unknown"', async () => {
    const run = (id: number) => checkRunNode(id, `run ${id}`, page([annotation('a.ts', id)]));
    const suites = pages([
      checkSuiteNode('CS_1', sonarApp, page([run(1)])),
      checkSuiteNode('CS_2', { name: 'My Linter', slug: '' }, page([run(2)])),
      checkSuiteNode('CS_3', null, page([run(3)])),
    ]);
    const { checkRuns } = await fetchPullRequest(fakeChecksClient({ suites }).client, ref, undefined, { withChecks: true });
    expect(checkRuns!.map((r) => r.app)).toEqual(['sq-community-pr-decoration', 'my linter', 'unknown']);
    expect(checkRuns!.map((r) => r.annotations[0]!.ref)).toEqual([
      annotationRef('sq-community-pr-decoration', 'a.ts', 1, 1, 'message a.ts:1'),
      annotationRef('my linter', 'a.ts', 2, 2, 'message a.ts:2'),
      annotationRef('unknown', 'a.ts', 3, 3, 'message a.ts:3'),
    ]);
  });

  it('reads a level it does not know, or none, as a notice', async () => {
    const run = sonarRun([annotation('a.ts', 1, null), annotation('a.ts', 2, 'SEVERE'), annotation('a.ts', 3, 'NOTICE')]);
    const suites = pages([checkSuiteNode('CS_1', sonarApp, page([run]))]);
    const { checkRuns } = await fetchPullRequest(fakeChecksClient({ suites }).client, ref, undefined, { withChecks: true });
    expect(checkRuns![0]!.annotations.map((a) => a.level)).toEqual(['notice', 'notice', 'notice']);
  });

  it('pages the check suites, the check runs of a suite and the annotations of a run, keeping the order', async () => {
    const suites = pages(
      [
        checkSuiteNode('CS_1', sonarApp, page([checkRunNode(10, 'SonarQube Code Analysis', page([annotation('a.ts', 1), annotation('a.ts', 2)], 'c1'))], 'c1')),
        checkSuiteNode('CS_2', { name: 'Lint', slug: 'lint' }, page([checkRunNode(20, 'Lint', page([annotation('l.ts', 5)]))])),
      ],
      [checkSuiteNode('CS_3', { name: 'Other', slug: 'other' }, page([checkRunNode(30, 'Other', page([annotation('o.ts', 6)]))]))],
    );
    // The first pages are embedded above: only the pages after the cursor "c1" are asked for.
    const checks: Checks = {
      suites,
      runs: { CS_1: pages([], [checkRunNode(11, 'Second', page([])), checkRunNode(12, 'Third', page([annotation('t.ts', 9)]))]) },
      annotations: { CR_10: pages([], [annotation('a.ts', 3)]) },
    };
    const { client, calls } = fakeChecksClient(checks);

    const { checkRuns } = await fetchPullRequest(client, ref, undefined, { withChecks: true });

    expect(checkRuns!.map((r) => [r.id, r.app, r.annotations.map((a) => `${a.path}:${a.startLine}`)])).toEqual([
      [10, 'sq-community-pr-decoration', ['a.ts:1', 'a.ts:2', 'a.ts:3']],
      [12, 'sq-community-pr-decoration', ['t.ts:9']],
      [20, 'lint', ['l.ts:5']],
      [30, 'other', ['o.ts:6']],
    ]);
    expect(calls).toEqual(['suites null', 'suites c1', 'runs CS_1 c1', 'annotations CR_10 c1']);
  });

  it('has an empty list when the head commit has no check suite', async () => {
    const { checkRuns } = await fetchPullRequest(fakeChecksClient({ suites: pages([]) }).client, ref, undefined, { withChecks: true });
    expect(checkRuns).toEqual([]);
  });

  describe('when reading them fails', () => {
    const suites = pages([checkSuiteNode('CS_1', sonarApp, page([sonarRun([annotation('a.ts', 1)])], 'c1'))]);
    const withChecks = (checks: Partial<Checks>) =>
      fetchPullRequest(fakeChecksClient({ suites, runs: { CS_1: pages([], []) }, ...checks }).client, ref, undefined, { withChecks: true });

    it('says that the check runs could not be read, and why', async () => {
      const error = await withChecks({ fail: () => new Error('GitHub API request failed: 502 Bad Gateway') }).catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(AccessDeniedError);
      expect((error as Error).message).toBe('reading the check runs failed: GitHub API request failed: 502 Bad Gateway');
    });

    it('says so for a later page too', async () => {
      const fail = (kind: string) => (kind === 'runs' ? new Error('timeout') : undefined);
      await expect(withChecks({ fail })).rejects.toThrow('reading the check runs failed: timeout');
    });

    it('lets refused access through unchanged, so another token can be tried', async () => {
      const denied = new AccessDeniedError('Resource not accessible by personal access token');
      const error = await withChecks({ fail: () => denied }).catch((e: unknown) => e);
      expect(error).toBe(denied);
    });
  });
});

describe('createGraphQLClient', () => {
  const okResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it('chooses the enterprise or github.com endpoint', () => {
    expect(graphqlEndpoint('ghe.example.com')).toBe('https://ghe.example.com/api/graphql');
    expect(graphqlEndpoint('github.com')).toBe('https://api.github.com/graphql');
  });

  it('sends the token as a bearer header and returns data', async () => {
    const fetchImpl = vi.fn(async () => okResponse({ data: { ok: true } }));
    const client = createGraphQLClient('ghe.example.com', 'secret', fetchImpl as unknown as typeof fetch);

    await expect(client('query { x }', { a: 1 })).resolves.toEqual({ ok: true });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://ghe.example.com/api/graphql');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'query { x }', variables: { a: 1 } });
  });

  it('reports HTTP failures without leaking the token', async () => {
    const fetchImpl = async () => new Response('nope', { status: 401, statusText: 'Unauthorized' });
    const client = createGraphQLClient('ghe.example.com', 'secret', fetchImpl as typeof fetch);
    const error = await client('q', {}).catch((e: Error) => e);
    expect((error as Error).message).toBe('GitHub API request failed: 401 Unauthorized');
  });

  it('reports GraphQL errors', async () => {
    const fetchImpl = async () => okResponse({ errors: [{ message: 'bad field' }, { message: 'other' }] });
    const client = createGraphQLClient('ghe.example.com', 'secret', fetchImpl as typeof fetch);
    await expect(client('q', {})).rejects.toThrow('GitHub GraphQL errors: bad field; other');
  });

  describe('an empty or missing message', () => {
    const failure = async (errors: unknown[]) => {
      const client = createGraphQLClient('ghe.example.com', 'secret', (async () => okResponse({ errors })) as typeof fetch);
      return (await client('q', {}).catch((e: unknown) => e)) as Error;
    };

    it('is described by the type of the error', async () => {
      const error = await failure([{ type: 'UNPROCESSABLE', message: '' }]);
      expect(error.message).toBe('GitHub GraphQL errors: (UNPROCESSABLE, no message)');
      expect(error).not.toBeInstanceOf(AccessDeniedError);
    });

    it('is described as missing when there is no type either', async () => {
      expect((await failure([{}])).message).toBe('GitHub GraphQL errors: (no message)');
      expect((await failure([{ message: '' }])).message).toBe('GitHub GraphQL errors: (no message)');
    });

    it('is joined with the others by "; ", and a message that is there stays as it is', async () => {
      const error = await failure([{ message: 'bad field' }, { type: 'UNPROCESSABLE', message: '' }, { message: 'other', type: 'NOT_FOUND' }, {}]);
      expect(error.message).toBe('GitHub GraphQL errors: bad field; (UNPROCESSABLE, no message); other; (no message)');
    });

    it('does not hide that access is refused', async () => {
      const error = await failure([{ type: 'FORBIDDEN', message: '' }]);
      expect(error).toBeInstanceOf(AccessDeniedError);
      expect(error.message).toBe('GitHub GraphQL errors: (FORBIDDEN, no message)');
    });
  });

  it('marks refused access, and only that, so another token can be tried', async () => {
    const failing = (response: () => Response) => createGraphQLClient('ghe.example.com', 's', (async () => response()) as typeof fetch)('q', {});
    const failure = (promise: Promise<unknown>) => promise.catch((e: unknown) => e);

    expect(await failure(failing(() => new Response('', { status: 401 })))).toBeInstanceOf(AccessDeniedError);
    expect(await failure(failing(() => new Response('', { status: 403 })))).toBeInstanceOf(AccessDeniedError);
    expect(
      await failure(failing(() => okResponse({ errors: [{ type: 'FORBIDDEN', message: 'Resource not accessible by personal access token' }] }))),
    ).toBeInstanceOf(AccessDeniedError);

    expect(await failure(failing(() => new Response('', { status: 502 })))).not.toBeInstanceOf(AccessDeniedError);
    expect(await failure(failing(() => okResponse({ errors: [{ message: 'bad field' }] })))).not.toBeInstanceOf(AccessDeniedError);
  });

  it('treats an unresolvable repository as refused access', async () => {
    const client: GraphQLClient = async () => {
      throw new Error("GitHub GraphQL errors: Could not resolve to a Repository with the name 'acme/widgets'.");
    };
    await expect(fetchPullRequest(client, ref)).rejects.toBeInstanceOf(AccessDeniedError);
  });
});
