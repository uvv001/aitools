import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export function tokenMemoPath(home: string = homedir()): string {
  return join(home, '.cache', 'pr-comments', 'token-sources.json');
}

// The memo only names the token source that worked (never the token), and a missing or broken memo
// must never stop a sync.
export async function recallTokenSource(path: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const value =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>).token_source
        : undefined;
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

export async function rememberTokenSource(path: string, id: string): Promise<void> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify({ token_source: id }, null, 2)}\n`, 'utf8');
  } catch {
    // Only an optimization: the next run simply tries the tokens in the usual order again.
  }
}
