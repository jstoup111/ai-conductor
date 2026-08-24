import { execa } from 'execa';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HaltClass } from './halt-marker.js';
import { withEngineCommitEnv } from './engine-commit-env.js';
import { resolveMainRepoRoot } from './park-marker.js';

/** Git-tracked records that let an operator inspect a feature halt from its branch. */
export const HALT_RECORD_DIR = '.docs/halted';

export interface HaltRecordInput {
  slug: string;
  haltClass: HaltClass;
  step: string;
  phase: string;
  branch: string;
  headSha: string;
  haltedAt: string;
  haltBody: string;
}

/** The operator action that resolved a previously raised halt. */
export interface HaltRecordResolution {
  cause: string;
  resolvedAt: string;
}

/** Outcome of an attempt to persist the durable halt record. */
export type HaltRecordResult =
  | { kind: 'written' }
  | { kind: 'noop' }
  | { kind: 'skipped' }
  | { kind: 'failed'; reason: string }
  | { kind: 'pushFailed'; reason: string };

/** Resolve a halt record's repository-relative path. */
export function haltRecordPath(slug: string): string {
  return `${HALT_RECORD_DIR}/${slug}.md`;
}

/** True when a halt requires operator action and merits a durable record. */
export function isRecordableHaltClass(haltClass: HaltClass): boolean {
  return (
    haltClass === 'needs-human' ||
    haltClass === 'plan-gap' ||
    haltClass === 'protected-artifact'
  );
}

/**
 * Decide whether a halt may be recorded from this checkout. The default
 * checkout must never gain a halt-record commit, and any unavailable branch
 * identity fails closed.
 */
export async function resolveRecordability(root: string, haltClass: HaltClass): Promise<boolean> {
  if (!isRecordableHaltClass(haltClass)) return false;

  try {
    const [branch, defaultBranch] = await Promise.all([
      currentBranch(root),
      resolveMainRepoRoot(root).then(currentBranch),
    ]);
    return branch !== 'HEAD' && branch !== defaultBranch;
  } catch {
    return false;
  }
}

/** Render the operator-readable, git-tracked record for a raised halt. */
export function renderHaltRecord(input: HaltRecordInput): string {
  const fence = haltBodyFence(input.haltBody);
  const bodySuffix = input.haltBody.endsWith('\n') ? '' : '\n';

  return (
    `# Halt record\n\n` +
    `Status: halted\n` +
    `Slug: ${input.slug}\n` +
    `Class: ${input.haltClass}\n` +
    `Halting step: ${input.step}\n` +
    `Phase: ${input.phase}\n` +
    `Branch: ${input.branch}\n` +
    `Head SHA: ${input.headSha}\n` +
    `Halted at: ${input.haltedAt}\n\n` +
    `Push status: this record may be ahead of the remote; push is not guaranteed.\n\n` +
    `## HALT\n\n` +
    `${fence}text\n${input.haltBody}${bodySuffix}${fence}\n`
  );
}

/** Mark a halted record resolved without discarding its original halt details. */
export function supersedeHaltRecordText(text: string, resolution: HaltRecordResolution): string {
  if (!text.includes('Status: halted\n')) return text;

  return text.replace(
    'Status: halted\n',
    `Status: resolved\nResolution cause: ${resolution.cause}\nResolved at: ${resolution.resolvedAt}\n`,
  );
}

/**
 * Write and commit a halt record only from a recordable feature checkout.
 * Every filesystem or Git failure is returned to the halt-marker seam instead
 * of escaping and disturbing the original halt flow.
 */
export async function recordHalt(root: string, input: HaltRecordInput): Promise<HaltRecordResult> {
  try {
    if (!await resolveRecordability(root, input.haltClass)) return { kind: 'skipped' };

    const relPath = haltRecordPath(input.slug);
    await mkdir(join(root, dirname(relPath)), { recursive: true });
    await writeFile(join(root, relPath), renderHaltRecord(input));

    const commitResult = await commitHaltRecordChange(root, relPath, `halt record: ${input.slug}`);
    if (commitResult.kind !== 'written') return commitResult;

    try {
      await execa('git', ['push'], { cwd: root });
    } catch (error) {
      return { kind: 'pushFailed', reason: errorMessage(error) };
    }

    return { kind: 'written' };
  } catch (error) {
    return { kind: 'failed', reason: errorMessage(error) };
  }
}

/** Resolve and commit an existing halt record, preserving its original halt details. */
export async function supersedeHaltRecord(
  root: string,
  slug: string,
  cause: string,
): Promise<HaltRecordResult> {
  try {
    const relPath = haltRecordPath(slug);
    const path = join(root, relPath);
    const current = await readFile(path, 'utf8');
    const superseded = supersedeHaltRecordText(current, { cause, resolvedAt: new Date().toISOString() });
    if (superseded === current) return { kind: 'noop' };

    await writeFile(path, superseded);
    return await commitHaltRecordChange(root, relPath, `halt record resolved: ${slug}`);
  } catch (error) {
    return { kind: 'failed', reason: errorMessage(error) };
  }
}

async function commitHaltRecordChange(
  root: string,
  relPath: string,
  message: string,
): Promise<HaltRecordResult> {
  await execa('git', ['add', '--', relPath], { cwd: root });
  const staged = await execa('git', ['diff', '--cached', '--quiet', '--', relPath], {
    cwd: root,
    reject: false,
  });
  if (staged.exitCode === 0) return { kind: 'noop' };
  if (staged.exitCode !== 1) return { kind: 'failed', reason: commandFailure(staged) };

  await execa('git', ['commit', '--no-verify', '-m', message], {
    cwd: root,
    env: withEngineCommitEnv(),
  });
  return { kind: 'written' };
}

function haltBodyFence(body: string): string {
  const longestRun = Math.max(
    0,
    ...Array.from(body.matchAll(/`+/g), (match) => match[0].length),
  );
  return '`'.repeat(Math.max(3, longestRun + 1));
}

async function currentBranch(root: string): Promise<string> {
  const { stdout } = await execa('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root });
  const branch = stdout.trim();
  if (!branch) throw new Error('current branch is empty');
  return branch;
}

function commandFailure(result: { stderr?: string; shortMessage?: string }): string {
  return result.stderr?.trim() || result.shortMessage || 'git diff --cached failed';
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const { stderr, shortMessage, message } = error as {
      stderr?: unknown;
      shortMessage?: unknown;
      message?: unknown;
    };
    for (const value of [stderr, shortMessage, message]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  }
  return String(error);
}
