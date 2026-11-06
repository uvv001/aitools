import { annotationRef } from './comment-ref.ts';
import type { AnnotationLevel, CheckRun, Comment, PullRequestData, Review, ReviewThread } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';

export type GraphQLClient = <T>(query: string, variables: Record<string, unknown>) => Promise<T>;

// The token was rejected or cannot see the pull request, so another token may succeed.
export class AccessDeniedError extends Error {}

export function graphqlEndpoint(host: string): string {
  return host === 'github.com' ? 'https://api.github.com/graphql' : `https://${host}/api/graphql`;
}

export function createGraphQLClient(host: string, token: string, fetchImpl: typeof fetch = fetch): GraphQLClient {
  return async <T>(query: string, variables: Record<string, unknown>) => {
    const response = await fetchImpl(graphqlEndpoint(host), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      const message = `GitHub API request failed: ${response.status} ${response.statusText}`;
      throw response.status === 401 || response.status === 403 ? new AccessDeniedError(message) : new Error(message);
    }
    const payload = (await response.json()) as { data?: T; errors?: { message: string; type?: string }[] };
    if (payload.errors?.length) {
      // GitHub sometimes refuses with an empty message (UNPROCESSABLE for a body it dislikes).
      const described = payload.errors.map((e) => e.message || (e.type ? `(${e.type}, no message)` : '(no message)'));
      const message = `GitHub GraphQL errors: ${described.join('; ')}`;
      const denied = payload.errors.some((e) => e.type === 'FORBIDDEN' || /Resource not accessible/.test(e.message));
      throw denied ? new AccessDeniedError(message) : new Error(message);
    }
    return payload.data as T;
  };
}

interface Connection<T> {
  nodes: (T | null)[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface Actor {
  login: string;
}

interface ReviewCommentNode {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  url: string;
  diffHunk: string;
  author: Actor | null;
  commit: { oid: string } | null;
  originalCommit: { oid: string } | null;
  replyTo: { id: string } | null;
  pullRequestReview: { id: string } | null;
}

interface IssueCommentNode {
  id: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  lastEditedAt: string | null;
  url: string;
  author: Actor | null;
}

interface ReviewNode {
  id: string;
  state: string;
  body: string;
  submittedAt: string | null;
  lastEditedAt: string | null;
  url: string;
  author: Actor | null;
  commit: { oid: string } | null;
}

interface ThreadNode {
  id: string;
  path: string;
  line: number | null;
  originalLine: number | null;
  startLine: number | null;
  originalStartLine?: number | null;
  isResolved: boolean;
  isOutdated: boolean;
  comments: Connection<ReviewCommentNode>;
}

interface PullRequestNode {
  id: string;
  title: string;
  body: string;
  state: string;
  url: string;
  createdAt: string;
  author: Actor | null;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
}

interface AnnotationNode {
  path: string;
  annotationLevel: string | null;
  title: string | null;
  message: string;
  rawDetails: string | null;
  location: { start: { line: number }; end: { line: number } | null };
}

interface CheckRunNode {
  id: string;
  databaseId: number;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
  annotations: Connection<AnnotationNode>;
}

interface CheckSuiteNode {
  id: string;
  app: { name: string; slug: string | null } | null;
  checkRuns: Connection<CheckRunNode>;
}

const PAGE_SIZE = 100;

// GitHub refuses a query that could return more than 500,000 nodes (the product of the nested page sizes), which
// 100 suites of 100 runs of 100 annotations would be.
const CHECK_PAGE_SIZE = 20;

const PAGE_INFO = 'pageInfo { hasNextPage endCursor }';

// updatedAt also moves when a pending review is submitted, so only lastEditedAt tells real edits.
const REVIEW_COMMENT_FIELDS = `
  id body createdAt updatedAt lastEditedAt url diffHunk
  author { login }
  commit { oid }
  originalCommit { oid }
  replyTo { id }
  pullRequestReview { id }`;

const ISSUE_COMMENT_FIELDS = 'id body createdAt updatedAt lastEditedAt url author { login }';

const REVIEW_FIELDS = 'id state body submittedAt lastEditedAt url author { login } commit { oid }';

const THREAD_FIELDS = `
  id path line originalLine startLine originalStartLine isResolved isOutdated
  comments(first: ${PAGE_SIZE}) { nodes {${REVIEW_COMMENT_FIELDS}} ${PAGE_INFO} }`;

const PULL_REQUEST_QUERY = `
query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      id title body state url createdAt
      author { login }
      baseRefName headRefName headRefOid
    }
  }
}`;

function connectionQuery(connection: string, nodeFields: string): string {
  return `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      ${connection}(first: ${PAGE_SIZE}, after: $after) { nodes {${nodeFields}} ${PAGE_INFO} }
    }
  }
}`;
}

const THREAD_COMMENTS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) {
    ... on PullRequestReviewThread {
      comments(first: ${PAGE_SIZE}, after: $after) { nodes {${REVIEW_COMMENT_FIELDS}} ${PAGE_INFO} }
    }
  }
}`;

const ANNOTATION_FIELDS = 'path annotationLevel title message rawDetails location { start { line } end { line } }';

const CHECK_RUN_FIELDS = `
  id databaseId name status conclusion detailsUrl
  annotations(first: ${PAGE_SIZE}) { nodes {${ANNOTATION_FIELDS}} ${PAGE_INFO} }`;

const CHECK_SUITE_FIELDS = `
  id app { name slug }
  checkRuns(first: ${CHECK_PAGE_SIZE}) { nodes {${CHECK_RUN_FIELDS}} ${PAGE_INFO} }`;

// The head commit is the last one of the pull request.
const CHECK_SUITES_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      commits(last: 1) {
        nodes {
          commit {
            oid
            checkSuites(first: ${CHECK_PAGE_SIZE}, after: $after) { nodes {${CHECK_SUITE_FIELDS}} ${PAGE_INFO} }
          }
        }
      }
    }
  }
}`;

const SUITE_CHECK_RUNS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) {
    ... on CheckSuite {
      checkRuns(first: ${CHECK_PAGE_SIZE}, after: $after) { nodes {${CHECK_RUN_FIELDS}} ${PAGE_INFO} }
    }
  }
}`;

const CHECK_RUN_ANNOTATIONS_QUERY = `
query($id: ID!, $after: String) {
  node(id: $id) {
    ... on CheckRun {
      annotations(first: ${PAGE_SIZE}, after: $after) { nodes {${ANNOTATION_FIELDS}} ${PAGE_INFO} }
    }
  }
}`;

async function fetchRemainingPages<T>(
  first: Connection<T>,
  fetchPage: (after: string) => Promise<Connection<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let page = first;
  for (;;) {
    for (const node of page.nodes) if (node) items.push(node);
    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) return items;
    page = await fetchPage(page.pageInfo.endCursor);
  }
}

async function fetchConnection<T>(
  client: GraphQLClient,
  ref: PullRequestRef,
  connection: string,
  nodeFields: string,
): Promise<T[]> {
  const query = connectionQuery(connection, nodeFields);
  const fetchPage = async (after: string | null) => {
    const data = await client<{ repository: { pullRequest: Record<string, Connection<T>> } }>(query, {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      after,
    });
    return data.repository.pullRequest[connection]!;
  };
  return fetchRemainingPages(await fetchPage(null), fetchPage);
}

async function fetchThreadComments(client: GraphQLClient, thread: ThreadNode): Promise<ReviewCommentNode[]> {
  return fetchRemainingPages(thread.comments, async (after) => {
    const data = await client<{ node: { comments: Connection<ReviewCommentNode> } }>(THREAD_COMMENTS_QUERY, {
      id: thread.id,
      after,
    });
    return data.node.comments;
  });
}

const login = (actor: Actor | null) => actor?.login ?? 'ghost';

const ANNOTATION_LEVELS: Record<string, AnnotationLevel> = { NOTICE: 'notice', WARNING: 'warning', FAILURE: 'failure' };

async function fetchSuiteCheckRuns(client: GraphQLClient, suite: CheckSuiteNode): Promise<CheckRunNode[]> {
  return fetchRemainingPages(suite.checkRuns, async (after) => {
    const data = await client<{ node: { checkRuns: Connection<CheckRunNode> } }>(SUITE_CHECK_RUNS_QUERY, {
      id: suite.id,
      after,
    });
    return data.node.checkRuns;
  });
}

async function fetchRunAnnotations(client: GraphQLClient, run: CheckRunNode): Promise<AnnotationNode[]> {
  return fetchRemainingPages(run.annotations, async (after) => {
    const data = await client<{ node: { annotations: Connection<AnnotationNode> } }>(CHECK_RUN_ANNOTATIONS_QUERY, {
      id: run.id,
      after,
    });
    return data.node.annotations;
  });
}

interface HeadCommitNode {
  oid: string;
  checkSuites: Connection<CheckSuiteNode>;
}

interface HeadCommitResponse {
  repository: { pullRequest: { commits: { nodes: ({ commit: HeadCommitNode } | null)[] } } };
}

async function readCheckRuns(client: GraphQLClient, ref: PullRequestRef): Promise<CheckRun[]> {
  const fetchHeadCommit = async (after: string | null) => {
    const data = await client<HeadCommitResponse>(CHECK_SUITES_QUERY, {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      after,
    });
    return data.repository.pullRequest.commits.nodes[0]?.commit;
  };
  const head = await fetchHeadCommit(null);
  if (!head) return [];
  const suites = await fetchRemainingPages(head.checkSuites, async (after) => (await fetchHeadCommit(after))!.checkSuites);

  const checkRuns: CheckRun[] = [];
  for (const suite of suites) {
    const app = suite.app?.slug || suite.app?.name.toLowerCase() || 'unknown';
    for (const run of await fetchSuiteCheckRuns(client, suite)) {
      const nodes = await fetchRunAnnotations(client, run);
      // Commit lint, code owner approvals ... have none: they are not about the code.
      if (nodes.length === 0) continue;
      checkRuns.push({
        id: run.databaseId,
        name: run.name,
        app,
        status: run.status,
        conclusion: run.conclusion,
        headSha: head.oid,
        detailsUrl: run.detailsUrl,
        annotations: nodes.map((a) => {
          const startLine = a.location.start.line;
          const endLine = a.location.end?.line ?? startLine;
          return {
            ref: annotationRef(app, a.path, startLine, endLine, a.message),
            path: a.path,
            startLine,
            endLine,
            level: ANNOTATION_LEVELS[a.annotationLevel ?? ''] ?? 'notice',
            title: a.title,
            message: a.message,
            rawDetails: a.rawDetails,
          };
        }),
      });
    }
  }
  return checkRuns;
}

// An access error keeps its meaning (another token may be allowed to read the checks); anything else says what failed.
async function fetchCheckRuns(client: GraphQLClient, ref: PullRequestRef): Promise<CheckRun[]> {
  try {
    return await readCheckRuns(client, ref);
  } catch (error) {
    if (error instanceof AccessDeniedError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`reading the check runs failed: ${message}`, { cause: error });
  }
}

export interface FetchOptions {
  // Also read the check runs of the head commit that have annotations (SonarQube's issues ...); off by default
  // because only the download needs them.
  withChecks?: boolean;
}

export async function fetchPullRequest(
  client: GraphQLClient,
  ref: PullRequestRef,
  now: () => Date = () => new Date(),
  { withChecks = false }: FetchOptions = {},
): Promise<PullRequestData> {
  // Taken before any request, so the data is at least as new as this moment.
  const fetchedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const notFound = () =>
    new AccessDeniedError(
      `Pull request ${ref.owner}/${ref.repo}#${ref.number} was not found or the token cannot access it ` +
        '(a fine-grained token must have the repository selected)',
    );
  let pr: PullRequestNode | null | undefined;
  try {
    const meta = await client<{ repository: { pullRequest: PullRequestNode | null } | null }>(PULL_REQUEST_QUERY, {
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
    });
    pr = meta.repository?.pullRequest;
  } catch (error) {
    if (error instanceof Error && /Could not resolve to a (Repository|PullRequest)/.test(error.message)) throw notFound();
    throw error;
  }
  if (!pr) throw notFound();

  const issueComments = await fetchConnection<IssueCommentNode>(client, ref, 'comments', ISSUE_COMMENT_FIELDS);
  const reviewNodes = await fetchConnection<ReviewNode>(client, ref, 'reviews', REVIEW_FIELDS);
  const threadNodes = await fetchConnection<ThreadNode>(client, ref, 'reviewThreads', THREAD_FIELDS);

  const reviews: Review[] = reviewNodes.map((r) => ({
    id: r.id,
    author: login(r.author),
    state: r.state,
    body: r.body,
    submittedAt: r.submittedAt,
    editedAt: r.lastEditedAt,
    commitSha: r.commit?.oid ?? null,
    url: r.url,
  }));

  const threads: ReviewThread[] = [];
  const comments: Comment[] = issueComments.map((c) => ({
    id: c.id,
    kind: 'issue',
    threadId: null,
    threadPosition: null,
    reviewId: null,
    replyToId: null,
    author: login(c.author),
    body: c.body,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    editedAt: c.lastEditedAt,
    commitSha: null,
    originalCommitSha: null,
    diffHunk: null,
    url: c.url,
  }));

  for (const thread of threadNodes) {
    threads.push({
      id: thread.id,
      path: thread.path,
      line: thread.line,
      originalLine: thread.originalLine,
      startLine: thread.startLine,
      ...(thread.originalStartLine == null ? {} : { originalStartLine: thread.originalStartLine }),
      isResolved: thread.isResolved,
      isOutdated: thread.isOutdated,
    });
    const threadComments = await fetchThreadComments(client, thread);
    threadComments.forEach((c, position) =>
      comments.push({
        id: c.id,
        kind: 'review',
        threadId: thread.id,
        threadPosition: position,
        reviewId: c.pullRequestReview?.id ?? null,
        replyToId: c.replyTo?.id ?? null,
        author: login(c.author),
        body: c.body,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        editedAt: c.lastEditedAt,
        commitSha: c.commit?.oid ?? null,
        originalCommitSha: c.originalCommit?.oid ?? null,
        diffHunk: c.diffHunk,
        url: c.url,
      }),
    );
  }

  const data: PullRequestData = {
    pullRequest: {
      id: pr.id,
      host: ref.host,
      owner: ref.owner,
      repo: ref.repo,
      number: ref.number,
      title: pr.title,
      body: pr.body,
      state: pr.state,
      author: login(pr.author),
      baseRef: pr.baseRefName,
      headRef: pr.headRefName,
      headSha: pr.headRefOid,
      url: pr.url,
      createdAt: pr.createdAt,
      fetchedAt,
    },
    reviews,
    threads,
    comments,
  };
  if (withChecks) data.checkRuns = await fetchCheckRuns(client, ref);
  return data;
}
