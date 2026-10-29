import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveTokens, tokenEnvVar, tokenFilePath } from './token.ts';

const host = 'ghe.example.com';
const hostScope = { host };
const ownerScope = { host, owner: 'Acme' };

describe('token naming', () => {
  const home = join('home', 'user');

  it('names the host-wide file after the host', () => {
    expect(tokenFilePath(hostScope, home)).toBe(join(home, '.config', 'tokens', host));
  });

  it('names an owner file <host>_<owner>, keeping the case of the owner', () => {
    expect(tokenFilePath(ownerScope, home)).toBe(join(home, '.config', 'tokens', 'ghe.example.com_Acme'));
  });

  it('keeps characters Windows forbids out of file names', () => {
    expect(tokenFilePath({ host: 'ghe.example.com:8443', owner: 'a/b' }, home)).toBe(
      join(home, '.config', 'tokens', 'ghe.example.com_8443_a_b'),
    );
  });

  it('derives environment variable names from host and owner', () => {
    expect(tokenEnvVar({ host: 'ghe.example.com' })).toBe('PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM');
    expect(tokenEnvVar({ host: 'ghe.example.com', owner: 'Acme-Dev' })).toBe('PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM__ACME_DEV');
    expect(tokenEnvVar({ host: 'ghe.example.com:8443' })).toBe('PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM_8443');
  });
});

describe('resolveTokens', () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'pr-comments-token-'));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  async function writeTokenFile(scope: { host: string; owner?: string }, content: string) {
    await mkdir(join(home, '.config', 'tokens'), { recursive: true });
    await writeFile(tokenFilePath(scope, home), content);
  }

  const tokensOf = async (owner: string, env: NodeJS.ProcessEnv = {}) =>
    (await resolveTokens(host, owner, { env, home })).map((c) => c.token);

  it('reads and trims the host-wide token file', async () => {
    await writeTokenFile(hostScope, '  secret-token \r\n');
    await expect(tokensOf('Acme')).resolves.toEqual(['secret-token']);
  });

  it('lists every token, the most specific first, environment before file within a scope', async () => {
    await writeTokenFile(hostScope, 'host-file');
    await writeTokenFile(ownerScope, 'owner-file');
    const env = { [tokenEnvVar(ownerScope)]: 'owner-env', [tokenEnvVar(hostScope)]: 'host-env' };

    await expect(tokensOf('acme', env)).resolves.toEqual(['owner-env', 'owner-file', 'host-env', 'host-file']);
    await expect(tokensOf('other', env)).resolves.toEqual(['host-env', 'host-file']);
  });

  it('describes each token by source without exposing it', async () => {
    await writeTokenFile(ownerScope, 'owner-file');
    const env = { [tokenEnvVar(hostScope)]: 'host-env' };
    const candidates = await resolveTokens(host, 'Acme', { env, home });

    expect(candidates.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: 'file:ghe.example.com_Acme', label: tokenFilePath(ownerScope, home) },
      { id: 'env:PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM', label: 'PR_COMMENTS_TOKEN_GHE_EXAMPLE_COM' },
    ]);
  });

  it('lists a token that is configured in several places only once', async () => {
    await writeTokenFile(hostScope, 'same-token');
    await writeTokenFile(ownerScope, 'same-token\n');
    await expect(tokensOf('Acme')).resolves.toEqual(['same-token']);
  });

  it('finds the owner file whatever the case of the owner in the URL or the file name', async () => {
    await writeTokenFile({ host, owner: 'ACME' }, 'owner-token');
    await expect(tokensOf('acme')).resolves.toEqual(['owner-token']);
    await expect(tokensOf('Acme')).resolves.toEqual(['owner-token']);
  });

  it('does not use the environment variable of another host', async () => {
    const env = { [tokenEnvVar({ host: 'github.com' })]: 'github-token' };
    await expect(tokensOf('Acme', env)).rejects.toThrow(/No token for Acme on ghe.example.com/);
  });

  it('explains where to put the token when nothing is configured', async () => {
    const promise = resolveTokens(host, 'Acme', { env: {}, home });
    await expect(promise).rejects.toThrow(tokenFilePath(ownerScope, home));
    await expect(promise).rejects.toThrow(tokenFilePath(hostScope, home));
    await expect(promise).rejects.toThrow(tokenEnvVar(hostScope));
  });

  it('rejects an empty token file', async () => {
    await writeTokenFile(hostScope, '\n');
    await expect(tokensOf('Acme')).rejects.toThrow(/empty/);
  });

  it('rejects a multi-line token file without echoing its content', async () => {
    await writeTokenFile(hostScope, 'secret-part-one\n# second line\n');
    const error = await tokensOf('Acme').catch((e: Error) => e);
    expect((error as Error).message).toMatch(/single line/);
    expect((error as Error).message).not.toContain('secret-part-one');
  });

  it('rejects an environment token with control characters without echoing it', async () => {
    const env = { [tokenEnvVar(hostScope)]: 'secret\u0000value' };
    const error = await tokensOf('Acme', env).catch((e: Error) => e);
    expect((error as Error).message).toMatch(/single line/);
    expect((error as Error).message).not.toContain('secret');
  });
});
