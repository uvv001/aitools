import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runGit = promisify(execFile);

const SHORT = 8;
const HASH = /^[0-9a-f]{8,64}$/u;
const NOT_A_REPOSITORY = 'not inside a git repository (run the command in the reviewed repository)';

interface GitFailure {
  code?: number | string;
  stderr?: string;
  message: string;
}

// git's messages are matched by their English text.
const git = (args: string[], cwd: string) => runGit('git', args, { cwd, env: { ...process.env, LC_ALL: 'C' } });

const firstLine = (stderr: string | undefined): string =>
  (stderr ?? '').trim().split('\n')[0]?.replace(/^(?:fatal|error): /u, '').trim() ?? '';

// `--quiet` says nothing about why a revision does not resolve: ask again without it, only on this path.
async function whyNot(revision: string, cwd: string): Promise<Error> {
  const stderr = await git(['rev-parse', '--verify', `--short=${SHORT}`, `${revision}^{commit}`], cwd).then(
    () => '',
    (error: GitFailure) => error.stderr ?? '',
  );
  if (stderr.includes('is ambiguous')) {
    return new Error(`revision "${revision}" is ambiguous in this repository; use a longer abbreviation`);
  }
  if (stderr.includes('expected commit type')) return new Error(`revision "${revision}" is not a commit`);
  return new Error(`revision "${revision}" does not exist in this repository`);
}

async function explain(error: unknown, revision: string, cwd: string): Promise<unknown> {
  const failure = error as GitFailure;
  if (failure.code === 'ENOENT') return new Error(`git could not be started (is it installed and on the PATH?): ${failure.message}`);
  if (failure.code === 1) return whyNot(revision, cwd);
  if (failure.code === 128 && /not a git repository/u.test(failure.stderr ?? '')) return new Error(NOT_A_REPOSITORY);
  if (typeof failure.code === 'number') return new Error(`git failed for revision "${revision}": ${firstLine(failure.stderr)}`);
  return error;
}

// The 8-character lower-case hash of the commit that `revision` (HEAD, a branch, a tag, any abbreviation or
// expression such as HEAD~1) names in the repository of `cwd`; what the review stores instead of what was typed.
export async function resolveRevision(revision: string, cwd: string): Promise<string> {
  if (revision.trim() === '') throw new Error('revision is empty');
  // git would read it as an option; no revision starts with a dash, and a control character cannot be passed on.
  if (revision.startsWith('-') || /[\u0000-\u001F\u007F]/u.test(revision)) {
    throw new Error(`revision "${revision}" is not a valid revision`);
  }
  let stdout: string;
  try {
    ({ stdout } = await git(['rev-parse', '--verify', '--quiet', `--short=${SHORT}`, `${revision}^{commit}`], cwd));
  } catch (error) {
    throw await explain(error, revision, cwd);
  }
  const hash = stdout.trim().toLowerCase();
  if (!HASH.test(hash)) throw new Error(`git answered "${stdout.trim()}" for revision "${revision}", not a commit hash`);
  return hash.slice(0, SHORT);
}
