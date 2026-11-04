import { AccessDeniedError } from './github.ts';

export type RestMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

// `path` is relative to the REST root, e.g. `/repos/o/r/pulls/5/files?per_page=100`; the result is the parsed JSON body.
export type RestClient = <T>(method: RestMethod, path: string, body?: unknown) => Promise<T>;

export function restBaseUrl(host: string): string {
  return host === 'github.com' ? 'https://api.github.com' : `https://${host}/api/v3`;
}

interface ErrorBody {
  message?: string;
  errors?: (string | { message?: string; field?: string; code?: string })[];
}

function summarizeError(error: NonNullable<ErrorBody['errors']>[number]): string {
  if (typeof error === 'string') return error;
  return error.message ?? [error.field, error.code].filter(Boolean).join(' ');
}

async function errorDetails(response: Response): Promise<string> {
  let body: ErrorBody | null;
  try {
    body = (await response.json()) as ErrorBody | null;
  } catch {
    return '';
  }
  const errors = Array.isArray(body?.errors) ? body.errors.map(summarizeError).filter(Boolean).join(', ') : '';
  return [body?.message, errors].filter(Boolean).join(': ');
}

async function failure(response: Response): Promise<Error> {
  const details = await errorDetails(response);
  const status = `${response.status} ${response.statusText}`.trim();
  const message = `GitHub API request failed: ${status}` + (details ? `: ${details}` : '');
  return response.status === 401 || response.status === 403 ? new AccessDeniedError(message) : new Error(message);
}

export function createRestClient(host: string, token: string, fetchImpl: typeof fetch = fetch): RestClient {
  const baseUrl = restBaseUrl(host);
  return async <T>(method: RestMethod, path: string, body?: unknown) => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) throw await failure(response);
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

export interface PullFile {
  filename: string;
  status: string;
  previous_filename?: string;
  // Missing for binary or very large files.
  patch?: string;
}

const FILES_PAGE_SIZE = 100;

// GitHub lists at most 3000 files of a pull request.
const FILES_MAX_PAGES = 30;

// All changed files of the pull request, every page.
export async function fetchPullFiles(
  rest: RestClient,
  ref: { owner: string; repo: string; number: number },
): Promise<PullFile[]> {
  const files: PullFile[] = [];
  for (let page = 1; page <= FILES_MAX_PAGES; page++) {
    const batch = await rest<PullFile[]>(
      'GET',
      `/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}/files?per_page=${FILES_PAGE_SIZE}&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < FILES_PAGE_SIZE) break;
  }
  return files;
}
