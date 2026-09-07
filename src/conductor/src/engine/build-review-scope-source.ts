import { posix, win32 } from 'node:path';

import type { GitRunner } from './rebase.js';

const ERROR_EXCERPT_BYTES = 480;

export type BuildReviewPathChange =
  | { readonly kind: 'A' | 'M' | 'D' | 'T' | 'U' | 'X' | 'B'; readonly path: string }
  | { readonly kind: 'R' | 'C'; readonly oldPath: string; readonly path: string };

/** A source-identity failure that is safe to carry into bounded gate evidence. */
export class BuildReviewSourceReadError extends Error {
  constructor(
    readonly kind: 'invalid-path' | 'required-read-failed' | 'inventory-failed',
    readonly path: string,
    detail = '',
  ) {
    super(`build_review source ${kind} for ${JSON.stringify(path)}${detail ? `: ${bounded(detail)}` : ''}`);
    this.name = 'BuildReviewSourceReadError';
  }
}

/** A frozen source read either has bytes or proves that this tree has no blob at that path. */
export type BuildReviewOptionalSourceRead =
  | { readonly kind: 'present'; readonly value: string }
  | { readonly kind: 'absent' };

function bounded(value: string): string {
  if (value.length <= ERROR_EXCERPT_BYTES) return value;
  return `${value.slice(0, ERROR_EXCERPT_BYTES)}… [truncated ${value.length - ERROR_EXCERPT_BYTES} bytes]`;
}

const CANONICAL_REPO_PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[A-Za-z0-9.](?:[A-Za-z0-9._\/@+ -]*[A-Za-z0-9._\/@+-])?(?:\/[A-Za-z0-9.](?:[A-Za-z0-9._\/@+ -]*[A-Za-z0-9._\/@+-])?)*$/;

// Keep source-reader paths no broader than persisted finding references. In
// particular, a prose sentence that happens to contain a path is not a path.
function isCanonicalRepoPath(path: string): boolean {
  if (!CANONICAL_REPO_PATH.test(path)) return false;
  if (!path.includes(' ')) return true;
  if (/[.,;:!?] |\.$|  /.test(path)) return false;
  const segments = path.split('/');
  return segments.length >= 2 && !segments[0]!.includes(' ');
}

/** Validate a portable repository-relative Git path before it reaches a Git revision expression. */
export function safeRepoRelativePath(path: string): string {
  if (
    !path || path.includes('\0') || posix.isAbsolute(path) || win32.isAbsolute(path)
    || path.includes('\\')
  ) {
    throw new BuildReviewSourceReadError('invalid-path', path);
  }
  const normalized = posix.normalize(path);
  if (
    normalized === '.' || normalized === '..' || normalized.startsWith('../')
    || normalized !== path || path.split('/').some((part) => part === '' || part === '.' || part === '..')
    || !isCanonicalRepoPath(path)
  ) {
    throw new BuildReviewSourceReadError('invalid-path', path);
  }
  return path;
}

/** Parse Git's machine-readable `--name-status -z` output without splitting filenames on whitespace. */
export function parseNameStatusZ(stdout: string): readonly BuildReviewPathChange[] {
  const fields = stdout.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes: BuildReviewPathChange[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]!;
    const kind = status[0] as BuildReviewPathChange['kind'];
    if (!kind || !/^[AMDTUXBRC]$/.test(kind)) {
      throw new BuildReviewSourceReadError('inventory-failed', status, 'invalid NUL name-status record');
    }
    if (kind === 'R' || kind === 'C') {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (oldPath === undefined || path === undefined) {
        throw new BuildReviewSourceReadError('inventory-failed', status, 'incomplete rename/copy record');
      }
      changes.push(Object.freeze({ kind, oldPath: safeRepoRelativePath(oldPath), path: safeRepoRelativePath(path) }));
    } else {
      const path = fields[index++];
      if (path === undefined) throw new BuildReviewSourceReadError('inventory-failed', status, 'incomplete path record');
      changes.push(Object.freeze({ kind, path: safeRepoRelativePath(path) }));
    }
  }
  return Object.freeze(changes);
}

/**
 * Per-input-assembly cache of source bytes. The key is the immutable commit
 * identity plus the validated repo-relative path, so callers cannot observe a
 * worktree mutation after the assembly begins.
 */
export class BuildReviewScopeSource {
  private readonly reads = new Map<string, Promise<{ readonly result: BuildReviewOptionalSourceRead; readonly detail?: string }>>();

  constructor(readonly git: GitRunner, readonly headSha: string) {}

  async readRequired(path: string): Promise<string> {
    return this.readAtRequired(this.headSha, path);
  }

  async readAtRequired(commitSha: string, path: string): Promise<string> {
    const safePath = safeRepoRelativePath(path);
    const read = await this.read(commitSha, safePath);
    if (read.result.kind === 'present') return read.result.value;
    throw new BuildReviewSourceReadError('required-read-failed', safePath, read.detail || 'blob is absent');
  }

  /** An optional HEAD side may be absent (for example, a deleted diff side). */
  async readOptional(path: string): Promise<BuildReviewOptionalSourceRead> {
    return this.readAtOptional(this.headSha, path);
  }

  async readAtOptional(commitSha: string, path: string): Promise<BuildReviewOptionalSourceRead> {
    return (await this.read(commitSha, safeRepoRelativePath(path))).result;
  }

  async inventory(baseSha: string, args: readonly string[]): Promise<readonly BuildReviewPathChange[]> {
    const result = await this.git([
      'diff', '--name-status', '-z', '--find-renames', `${baseSha}..${this.headSha}`, ...args,
    ]);
    if (result.exitCode !== 0) {
      throw new BuildReviewSourceReadError('inventory-failed', '.', result.stderr || 'git diff --name-status failed');
    }
    return parseNameStatusZ(result.stdout);
  }

  private read(commitSha: string, path: string): Promise<{ readonly result: BuildReviewOptionalSourceRead; readonly detail?: string }> {
    const key = `${commitSha}\0${path}`;
    let pending = this.reads.get(key);
    if (!pending) {
      pending = this.readBlob(commitSha, path);
      this.reads.set(key, pending);
    }
    return pending;
  }

  private async readBlob(commitSha: string, path: string): Promise<{ readonly result: BuildReviewOptionalSourceRead; readonly detail?: string }> {
    const result = await this.git(['show', `${commitSha}:${path}`]);
    if (result.exitCode === 0) return Object.freeze({ result: Object.freeze({ kind: 'present', value: result.stdout }) });

    // Do not infer absence from Git's human stderr. `show` may fail to read a
    // blob that is present in the already-pinned tree; only Git's tree probe
    // can distinguish that from a genuinely absent optional side.
    const tree = await this.git(['ls-tree', '-z', commitSha, '--', path]);
    if (tree.exitCode === 0 && tree.stdout === '') {
      return Object.freeze({ result: Object.freeze({ kind: 'absent' }), detail: result.stderr });
    }
    throw new BuildReviewSourceReadError(
      'required-read-failed',
      path,
      result.stderr || tree.stderr || 'git show failed for a blob present in the pinned tree',
    );
  }
}
