import { describe, expect, it, vi } from 'vitest';
import { AccessDeniedError } from './github.ts';
import { createRestClient, fetchPullFiles, restBaseUrl, type PullFile, type RestClient } from './rest.ts';

const TOKEN = 'secret-token';

const json = (body: unknown, status = 200, statusText = '') =>
  new Response(JSON.stringify(body), { status, statusText, headers: { 'Content-Type': 'application/json' } });

function clientWith(respond: () => Response, host = 'ghe.example.com') {
  const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => respond());
  return { client: createRestClient(host, TOKEN, fetchImpl as unknown as typeof fetch), fetchImpl };
}

const failure = async (respond: () => Response): Promise<Error> => {
  const { client } = clientWith(respond);
  return client('POST', '/x', {}).then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: Error) => error,
  );
};

describe('restBaseUrl', () => {
  it('chooses the github.com or enterprise root', () => {
    expect(restBaseUrl('github.com')).toBe('https://api.github.com');
    expect(restBaseUrl('ghe.example.com')).toBe('https://ghe.example.com/api/v3');
    expect(restBaseUrl('ghe.example.com:8443')).toBe('https://ghe.example.com:8443/api/v3');
  });
});

describe('createRestClient', () => {
  it('sends a GET with the token and no body', async () => {
    const { client, fetchImpl } = clientWith(() => json([{ id: 1 }]));

    await expect(client('GET', '/repos/acme/widgets/pulls/5/files?per_page=100&page=1')).resolves.toEqual([{ id: 1 }]);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://ghe.example.com/api/v3/repos/acme/widgets/pulls/5/files?per_page=100&page=1');
    expect(init).toEqual({
      method: 'GET',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      body: undefined,
    });
  });

  it('sends a JSON body with its content type and uses the api.github.com root', async () => {
    const { client, fetchImpl } = clientWith(() => json({ id: 7 }, 201), 'github.com');

    await expect(client('POST', '/repos/acme/widgets/pulls/5/reviews', { event: 'COMMENT', body: 'hi' })).resolves.toEqual({ id: 7 });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/repos/acme/widgets/pulls/5/reviews');
    expect(init!.method).toBe('POST');
    expect(init!.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    });
    expect(JSON.parse(init!.body as string)).toEqual({ event: 'COMMENT', body: 'hi' });
  });

  it('resolves undefined for 204 and for an empty body', async () => {
    await expect(clientWith(() => new Response(null, { status: 204 })).client('DELETE', '/x')).resolves.toBeUndefined();
    await expect(clientWith(() => new Response('', { status: 200 })).client('PATCH', '/x', {})).resolves.toBeUndefined();
  });

  it('explains a validation failure with the offending review state', async () => {
    const error = await failure(() =>
      json(
        {
          message: 'Validation Failed',
          errors: [
            {
              resource: 'PullRequestReview',
              code: 'custom',
              field: 'user_id',
              message: 'user_id can only have one pending review per pull request',
            },
          ],
          documentation_url: 'https://docs.github.com/enterprise-server/rest/pulls/reviews',
        },
        422,
        'Unprocessable Entity',
      ),
    );
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(error.message).toBe(
      'GitHub API request failed: 422 Unprocessable Entity: Validation Failed: user_id can only have one pending review per pull request',
    );
  });

  it('falls back to field and code when an error has no message', async () => {
    const error = await failure(() =>
      json(
        {
          message: 'Validation Failed',
          errors: [
            {
              resource: 'PullRequestReviewComment',
              code: 'custom',
              field: 'pull_request_review_thread.line',
              message: 'pull_request_review_thread.line must be part of the diff',
            },
            { resource: 'PullRequestReviewComment', code: 'missing_field', field: 'pull_request_review_thread.diff_hunk' },
          ],
        },
        422,
        'Unprocessable Entity',
      ),
    );
    expect(error).not.toBeInstanceOf(AccessDeniedError);
    expect(error.message).toBe(
      'GitHub API request failed: 422 Unprocessable Entity: Validation Failed: ' +
        'pull_request_review_thread.line must be part of the diff, pull_request_review_thread.diff_hunk missing_field',
    );
  });

  it('accepts plain string entries in errors', async () => {
    const error = await failure(() => json({ message: 'Validation Failed', errors: ['No commit found for SHA: abc'] }, 422, 'Unprocessable Entity'));
    expect(error.message).toBe('GitHub API request failed: 422 Unprocessable Entity: Validation Failed: No commit found for SHA: abc');
  });

  it('marks 401 and 403 as refused access so another token can be tried', async () => {
    const unauthorized = await failure(() => json({ message: 'Bad credentials' }, 401, 'Unauthorized'));
    expect(unauthorized).toBeInstanceOf(AccessDeniedError);
    expect(unauthorized.message).toBe('GitHub API request failed: 401 Unauthorized: Bad credentials');

    const forbidden = await failure(() => json({ message: 'Resource not accessible by personal access token' }, 403, 'Forbidden'));
    expect(forbidden).toBeInstanceOf(AccessDeniedError);
    expect(forbidden.message).toBe('GitHub API request failed: 403 Forbidden: Resource not accessible by personal access token');
  });

  it('keeps 404 and other failures as plain errors', async () => {
    const notFound = await failure(() => json({ message: 'Not Found' }, 404, 'Not Found'));
    expect(notFound).not.toBeInstanceOf(AccessDeniedError);
    expect(notFound.message).toBe('GitHub API request failed: 404 Not Found: Not Found');

    const unavailable = await failure(() => new Response('<html>oops</html>', { status: 502, statusText: 'Bad Gateway' }));
    expect(unavailable).not.toBeInstanceOf(AccessDeniedError);
    expect(unavailable.message).toBe('GitHub API request failed: 502 Bad Gateway');
  });

  it('omits the status text when the server sends none', async () => {
    const error = await failure(() => json({ message: 'Not Found' }, 404));
    expect(error.message).toBe('GitHub API request failed: 404: Not Found');
  });

  it('never puts the token into an error message', async () => {
    const responses = [
      () => json({ message: 'Bad credentials' }, 401, 'Unauthorized'),
      () => json({ message: 'Validation Failed', errors: [{ field: 'x', code: 'invalid' }] }, 422, 'Unprocessable Entity'),
      () => new Response('nope', { status: 500, statusText: 'Internal Server Error' }),
    ];
    for (const respond of responses) expect((await failure(respond)).message).not.toContain(TOKEN);
  });
});

describe('fetchPullFiles', () => {
  const pull = { owner: 'acme', repo: 'widgets', number: 5 };
  const files = (count: number, from = 0): PullFile[] =>
    Array.from({ length: count }, (_, i) => ({ filename: `f${from + i}.ts`, status: 'modified', patch: '@@ -1 +1 @@' }));

  function fakeRest(pages: PullFile[][]) {
    const calls: string[] = [];
    const rest = (async (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return pages[calls.length - 1] ?? [];
    }) as unknown as RestClient;
    return { rest, calls };
  }

  it('concatenates pages until one is short', async () => {
    const { rest, calls } = fakeRest([files(100), files(37, 100)]);

    const result = await fetchPullFiles(rest, pull);

    expect(result).toHaveLength(137);
    expect(result[136]!.filename).toBe('f136.ts');
    expect(calls).toEqual([
      'GET /repos/acme/widgets/pulls/5/files?per_page=100&page=1',
      'GET /repos/acme/widgets/pulls/5/files?per_page=100&page=2',
    ]);
  });

  it('asks for another page after exactly 100 files', async () => {
    const { rest, calls } = fakeRest([files(100), []]);
    expect(await fetchPullFiles(rest, pull)).toHaveLength(100);
    expect(calls).toHaveLength(2);
  });

  it('makes one request for a short first page', async () => {
    const { rest, calls } = fakeRest([files(3)]);
    expect(await fetchPullFiles(rest, pull)).toHaveLength(3);
    expect(calls).toHaveLength(1);
  });

  it('stops after the 30 pages GitHub serves', async () => {
    const { rest, calls } = fakeRest(Array.from({ length: 40 }, () => files(100)));
    expect(await fetchPullFiles(rest, pull)).toHaveLength(3000);
    expect(calls).toHaveLength(30);
    expect(calls[29]).toContain('page=30');
  });
});
