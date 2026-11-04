export interface PullRequestRef {
  host: string;
  owner: string;
  repo: string;
  number: number;
}

export function formatPullRequestUrl({ host, owner, repo, number }: PullRequestRef): string {
  return `https://${host}/${owner}/${repo}/pull/${number}`;
}

export function parsePullRequestUrl(input: string): PullRequestRef {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`Not a valid URL: ${input}`);
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/.exec(url.pathname);
  if (!match) {
    throw new Error(`Not a pull request URL (expected https://<host>/<owner>/<repo>/pull/<number>): ${input}`);
  }
  return { host: url.host, owner: match[1]!, repo: match[2]!, number: Number(match[3]) };
}
