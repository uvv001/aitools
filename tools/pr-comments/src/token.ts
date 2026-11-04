import { readdir, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export interface TokenScope {
  host: string;
  owner?: string;
}

const envSegment = (text: string) => text.toUpperCase().replaceAll(/[^A-Z0-9]/g, '_');
// ':' is not allowed in Windows file names; keep names free of anything that could act as a path.
const fileSegment = (text: string) => text.replaceAll(/[^A-Za-z0-9._-]/g, '_');

// Scoped per host (and optionally per owner) so a token is never sent where it was not meant to go.
export function tokenEnvVar({ host, owner }: TokenScope): string {
  return `PR_COMMENTS_TOKEN_${envSegment(host)}${owner ? `__${envSegment(owner)}` : ''}`;
}

export function tokenFilePath({ host, owner }: TokenScope, home: string = homedir()): string {
  const name = owner ? `${fileSegment(host)}_${fileSegment(owner)}` : fileSegment(host);
  return join(home, '.config', 'tokens', name);
}

// Host and owner names are case-insensitive on GitHub, but Linux file names are not.
async function findTokenFile(scope: TokenScope, home: string): Promise<string | undefined> {
  const expected = tokenFilePath(scope, home);
  const wanted = basename(expected).toLowerCase();
  let names: string[];
  try {
    names = await readdir(dirname(expected));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const match = names.find((name) => name.toLowerCase() === wanted);
  return match && join(dirname(expected), match);
}

export interface TokenSources {
  env?: NodeJS.ProcessEnv;
  home?: string;
}

// An invalid header value makes fetch throw an error that contains the whole value, so reject it before it is used.
function validated(token: string, source: string): string {
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new Error(`The token in ${source} must be a single line of visible ASCII characters`);
  }
  return token;
}

export interface TokenCandidate {
  // Identifies where the token came from, so the choice can be remembered without storing the token.
  id: string;
  // Safe to show: the environment variable name or the file path, never the token.
  label: string;
  token: string;
}

// Every available token, most specific first: <host>_<owner> before <host>; within a scope the environment
// variable before the file. A token that appears in several places is listed once.
export async function resolveTokens(
  host: string,
  owner: string,
  { env = process.env, home = homedir() }: TokenSources = {},
): Promise<TokenCandidate[]> {
  const scopes: TokenScope[] = [{ host, owner }, { host }];
  const candidates: TokenCandidate[] = [];
  const add = (candidate: TokenCandidate) => {
    if (!candidates.some((existing) => existing.token === candidate.token)) candidates.push(candidate);
  };

  for (const scope of scopes) {
    const envVar = tokenEnvVar(scope);
    const fromEnv = env[envVar]?.trim();
    if (fromEnv) add({ id: `env:${envVar}`, label: envVar, token: validated(fromEnv, envVar) });

    const path = await findTokenFile(scope, home);
    if (!path) continue;
    const token = (await readFile(path, 'utf8')).trim();
    if (!token) throw new Error(`Token file ${path} is empty`);
    add({ id: `file:${basename(path)}`, label: path, token: validated(token, path) });
  }

  if (candidates.length === 0) {
    const [specific, general] = scopes as [TokenScope, TokenScope];
    throw new Error(
      `No token for ${owner} on ${host}. Put a token in ${tokenFilePath(specific, home)} (this owner only) ` +
        `or ${tokenFilePath(general, home)} (any owner on this host), or set ${tokenEnvVar(specific)} or ${tokenEnvVar(general)}`,
    );
  }
  return candidates;
}
