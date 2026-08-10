// engineer/release-metadata-inject.ts — guarantee a spec PR declares a release
// disposition.
//
// `openSpecPr` creates the PR with `gh pr create --fill`, which builds the body
// from the branch name and the last commit message. That body never contains a
// `## Release metadata` section, so the required release-metadata check fails
// closed on every landed spec PR and an operator repairs it by hand.
//
// A specification-only PR is `no-note` by the repository's own release contract
// (it names specification-only changes as the default disposition), so the value
// is derivable rather than a judgement call — which is what makes this safe to
// do mechanically instead of asking an agent to remember the template.
//
// Mirrors issue-ref.ts: injected `gh`, idempotent, and NON-FATAL — a write-back
// failure never discards the delivered PR.

import { parseReleaseDisposition } from '../release-metadata.js';

/** Shell runner for the `gh` CLI. Same shape as issue-ref.ts's GhRunner. */
export type GhRunner = (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }>;

export interface EnsureReleaseMetadataOpts {
  gh: GhRunner;
  prUrl: string;
  cwd: string;
  log?: (msg: string) => void;
}

/**
 * The block appended when a body declares no disposition. Byte-identical to the
 * shape `.github/pull_request_template.md` teaches, so a human editing it later
 * sees the form they expect.
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
 * Append the default disposition when the PR body declares none.
 *
 * Returns true when the body was edited. An existing valid disposition — of
 * either kind — is left byte-exact: the author's declaration always wins, and
 * re-running is a no-op, so this is safe to call on every handoff.
 */
export async function ensureReleaseMetadata(opts: EnsureReleaseMetadataOpts): Promise<boolean> {
  const { gh, prUrl, cwd } = opts;
  const log = opts.log ?? (() => {});

  try {
    const { stdout } = await gh(['pr', 'view', prUrl, '--json', 'body'], { cwd });
    let body = '';
    try {
      body = String((JSON.parse(stdout || '{}') as { body?: unknown }).body ?? '');
    } catch {
      body = '';
    }

    // The parser is the authority on "does this body declare a disposition?".
    // Re-implementing that test here would let the two drift, and this guard
    // exists precisely because the required check uses the parser's answer.
    try {
      parseReleaseDisposition(body);
      return false; // already declared — never overwrite the author.
    } catch {
      // No parseable disposition: fall through and supply the default.
    }

    const newBody =
      body.trim() === ''
        ? DEFAULT_SPEC_RELEASE_BLOCK
        : `${body.replace(/\s+$/, '')}\n\n${DEFAULT_SPEC_RELEASE_BLOCK}`;
    await gh(['pr', 'edit', prUrl, '--body', newBody], { cwd });
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`ensureReleaseMetadata: non-fatal write-back failure for ${prUrl} — ${msg}`);
    return false;
  }
}
