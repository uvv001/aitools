import { homedir } from 'node:os';
import { AccessDeniedError, createGraphQLClient, fetchPullRequest } from './github.ts';
import type { GraphQLClient } from './github.ts';
import type { PullRequestData } from './model.ts';
import type { PullRequestRef } from './pr-url.ts';
import { resolveTokens } from './token.ts';
import { recallTokenSource, rememberTokenSource, tokenMemoPath } from './token-memo.ts';

export interface TokenContext {
  client: GraphQLClient;
  token: string;
  host: string;
  fetchImpl: typeof fetch;
}

export interface TokenLoopOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetchImpl?: typeof fetch;
  purpose?: 'read' | 'write';
}

export interface DownloadOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

// Runs `operation` with each available token until one is good enough, and remembers which one worked so the
// next run starts with it. Only AccessDeniedError moves on to the next token; anything else is real and
// propagates (an operation that has already written something must turn an access error into a plain Error).
// A write-capable token is remembered apart from the one that merely works for reading.
export async function withWorkingToken<T>(
  ref: { host: string; owner: string },
  operation: (context: TokenContext) => Promise<T>,
  { env = process.env, home = homedir(), fetchImpl = fetch, purpose = 'read' }: TokenLoopOptions = {},
): Promise<T> {
  const candidates = await resolveTokens(ref.host, ref.owner, { env, home });
  const memoPath = tokenMemoPath(home);
  const key = `${ref.host}/${ref.owner}`.toLowerCase() + (purpose === 'write' ? '#write' : '');
  const remembered = await recallTokenSource(memoPath, key);
  const ordered = [...candidates].sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered));

  const refused: string[] = [];
  let lastError: AccessDeniedError | undefined;
  for (const candidate of ordered) {
    try {
      const client = createGraphQLClient(ref.host, candidate.token, fetchImpl);
      const result = await operation({ client, token: candidate.token, host: ref.host, fetchImpl });
      if (candidate.id !== remembered) await rememberTokenSource(memoPath, key, candidate.id);
      return result;
    } catch (error) {
      if (!(error instanceof AccessDeniedError)) throw error;
      lastError = error;
      refused.push(candidate.label);
    }
  }
  throw new AccessDeniedError(`${lastError!.message}; tokens tried: ${refused.join(', ')}`);
}

export function downloadPullRequest(
  ref: PullRequestRef,
  { env, home, fetchImpl, now }: DownloadOptions = {},
): Promise<PullRequestData> {
  return withWorkingToken(ref, ({ client }) => fetchPullRequest(client, ref, now, { withChecks: true }), {
    env,
    home,
    fetchImpl,
  });
}
