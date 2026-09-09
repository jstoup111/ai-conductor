// engineer/release-metadata-inject.ts — supply a release disposition on spec PRs
// opened into a repository that requires one.
//
// `openSpecPr` creates the PR with `gh pr create --fill`, which builds the body
// from the branch name and the last commit message. That body never contains a
// `## Release metadata` section, so a repository whose required check parses one
// fails closed on every landed spec PR and an operator repairs it by hand.
//
// SCOPE. The release-disposition contract is NOT universal — it belongs to
// whichever repository configures it, and `openSpecPr` runs against every repo in
// the engineer's registry. Injecting the block unconditionally would stamp a
// meaningless (and misleading) declaration into consumer PRs that have no such
// check. So the target repository must say it wants one: it declares the contract
// in `.github/pull_request_template.md`, which is exactly where the convention
// says the contract lives. No template, no marker, unreadable file → no-op, which
// is the pre-existing behavior for every repo that never opted in.
//
// Mirrors issue-ref.ts otherwise: injected `gh`, idempotent, and NON-FATAL — a
// write-back failure never discards the delivered PR.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseReleaseDisposition } from '../release-metadata.js';
import type { GitRunner } from '../pr-labels.js';

/** Shell runner for the `gh` CLI. Same shape as issue-ref.ts's GhRunner. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

/** Reads a repo-relative file. Injected so tests never touch a real checkout. */
export type FileReader = (path: string) => Promise<string>;

export interface EnsureReleaseMetadataOpts {
  gh: GhRunner;
  prUrl: string;
  /** Repository root (the spec worktree) — both the gh cwd and the template root. */
  cwd: string;
  readTemplate?: FileReader;
  log?: (msg: string) => void;
}

/** Dependencies for composing explicit create arguments for an opted-in spec PR. */
export interface BuildSpecPrCreateArgsOpts {
  /** Repository root containing the opt-in PR template. */
  cwd: string;
  /** Named spec branch whose tip commit supplies the autofill-equivalent message. */
  branch: string;
  /** Injected Git runner; a read failure falls back to gh's existing --fill behavior. */
  git: GitRunner;
  /** Optional template seam so unit tests never read a real checkout. */
  readTemplate?: FileReader;
}

const PR_TEMPLATE_PATH = '.github/pull_request_template.md';

/**
 * The block appended when a body declares no disposition. Byte-identical to the
 * shape the PR template teaches, so a human editing it later sees the form they
 * expect.
 */
export const DEFAULT_SPEC_RELEASE_BLOCK = [
  '## Release metadata',
  '',
  'Release-Disposition: no-note',
  '',
  '## Migration',
  '',
  'none',
].join('\n');

/**
 * Preserve an author declaration byte-for-byte, or append the default release
 * block using the existing post-create repair's whitespace convention.
 */
export function composeSpecPrBody(body: string): string {
  try {
    parseReleaseDisposition(body);
    return body;
  } catch {
    return body.trim() === ''
      ? DEFAULT_SPEC_RELEASE_BLOCK
      : `${body.replace(/\s+$/, '')}\n\n${DEFAULT_SPEC_RELEASE_BLOCK}`;
  }
}

/**
 * Does this repository require a release disposition on its PRs?
 *
 * Decided from the target repo's own PR template rather than from a flag in this
 * engine, so a repository opts in by configuring the contract it already
 * documents — and no repository is opted in on its behalf.
 */
export async function declaresReleaseDisposition(
  cwd: string,
  readTemplate: FileReader = (p) => readFile(p, 'utf-8'),
): Promise<boolean> {
  try {
    return /^Release-Disposition:/m.test(await readTemplate(join(cwd, PR_TEMPLATE_PATH)));
  } catch {
    // Missing or unreadable template: the repository has not asked for this.
    return false;
  }
}

/**
 * Build explicit gh create arguments only for repositories that opted into the
 * release-disposition contract. Failures intentionally return [] so callers
 * retain the pre-existing `--fill` path and can still use post-create repair.
 */
export async function buildSpecPrCreateArgs(
  opts: BuildSpecPrCreateArgsOpts,
): Promise<string[]> {
  if (!(await declaresReleaseDisposition(opts.cwd, opts.readTemplate))) return [];

  try {
    const { stdout } = await opts.git(['show', '-s', '--format=%B', opts.branch], { cwd: opts.cwd });
    const body = String(stdout);
    return ['--title', body.split(/\r?\n/, 1)[0]!, '--body', composeSpecPrBody(body)];
  } catch {
    return [];
  }
}

/**
 * Append the default disposition when the target repo requires one and the PR
 * body declares none.
 *
 * Returns true when the body was edited. An existing valid disposition — of
 * either kind — is left byte-exact: the author's declaration always wins, and
 * re-running is a no-op, so this is safe to call on every handoff.
 */
export async function ensureReleaseMetadata(opts: EnsureReleaseMetadataOpts): Promise<boolean> {
  const { gh, prUrl, cwd } = opts;
  const log = opts.log ?? (() => {});

  if (!(await declaresReleaseDisposition(cwd, opts.readTemplate))) {
    return false; // This repository does not require a disposition.
  }

  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    let body = '';
    try {
      body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
    } catch {
      body = '';
    }

    const newBody = composeSpecPrBody(body);
    if (newBody === body) return false; // already declared — never overwrite the author.
    await gh(['pr', 'edit', prUrl, '--body', newBody], { cwd });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ensureReleaseMetadata: non-fatal write-back failure for ${prUrl} — ${msg}`);
    return false;
  }
}
