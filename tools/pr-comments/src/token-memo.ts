import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function tokenMemoPath(home: string = homedir()): string {
  return join(home, '.cache', 'pr-comments', 'token-sources.json');
}

async function readMemo(path: string): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

// The memo only names the token source that worked (never the token), and a missing or broken memo
// must never stop a sync.
export async function recallTokenSource(path: string, key: string): Promise<string | undefined> {
  const value = (await readMemo(path))[key];
  return typeof value === 'string' ? value : undefined;
}

export async function rememberTokenSource(path: string, key: string, id: string): Promise<void> {
  try {
    const memo = await readMemo(path);
    memo[key] = id;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(memo, null, 2)}\n`, 'utf8');
  } catch {
    // Only an optimization: the next run simply tries the tokens in the usual order again.
  }
}
