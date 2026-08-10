// Test: openSpecPr guarantees every spec PR carries a valid release-metadata block.
//
// `gh pr create --fill` builds the body from the branch name and last commit
// message, so a landed spec PR has no `## Release metadata` section at all and
// the required release-metadata check fails closed on every one of them. That
// has been repaired by hand repeatedly (#1435, #1438, #1443, #1445, #1446).
//
// A specification-only PR is `no-note` by definition — the repository's release
// contract names specification-only changes as the default disposition — so the
// correct value is derivable and needs no judgement. The injection therefore
// runs unconditionally (not only when a sourceRef exists), is idempotent, never
// overwrites an author's existing disposition, and is non-fatal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';

const PR_URL = 'https://github.com/acme/app/pull/53';

function makeRunner(initialBody = 'spec: land authored artifacts for "x" [engineer/land]') {
  let body = initialBody;
  const editCalls: string[] = [];
  const runner: HandoffDeps['runner'] = async (args) => {
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify({ body }), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      body = args[args.indexOf('--body') + 1]!;
      editCalls.push(body);
      return { stdout: '', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { runner, getBody: () => body, editCalls };
}

let tempDir: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'handoff-relmeta-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function target(): TargetRepo {
  return { name: 'app', canonicalPath: tempDir, remote: 'https://github.com/acme/app.git' };
}

const noOpGitRunner: NonNullable<HandoffDeps['gitRunner']> = async () => ({
  stdout: '',
  stderr: '',
});

function deps(extra: Partial<HandoffDeps> = {}): HandoffDeps {
  return {
    runner: makeRunner().runner,
    gitRunner: noOpGitRunner,
    ledgerOpts: { engineerDir: tempDir },
    ...extra,
  } as HandoffDeps;
}

describe('openSpecPr — spec PR release metadata', () => {
  it('adds a no-note disposition when the --fill body carries none', async () => {
    const { runner, getBody } = makeRunner();
    const result = await openSpecPr(target(), 'spec/dep-bump', deps({ runner }));

    expect(result.kind).toBe('pr-opened');
    expect(getBody()).toContain('## Release metadata');
    // The authoritative assertion is that the real parser accepts the result —
    // not that some substring is present.
    expect(parseReleaseDisposition(getBody())).toEqual({ disposition: 'no-note' });
  });

  it('injects the block even when no sourceRef is supplied', async () => {
    // Every PR must declare a disposition, whether or not it links an issue.
    // PR #1438 landed with an empty body and no sourceRef, and failed the check.
    const { runner, getBody } = makeRunner();
    await openSpecPr(target(), 'spec/no-source-ref', deps({ runner }));

    expect(parseReleaseDisposition(getBody())).toEqual({ disposition: 'no-note' });
  });

  it('never overwrites an author-supplied note disposition', async () => {
    const authored = [
      '## Release metadata',
      '',
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Something reader-facing.',
    ].join('\n');
    const { runner, getBody } = makeRunner(authored);

    await openSpecPr(target(), 'spec/authored', deps({ runner }));

    expect(parseReleaseDisposition(getBody())).toMatchObject({
      disposition: 'note',
      category: 'Fixed',
      semver: 'patch',
    });
    expect(getBody()).not.toContain('Release-Disposition: no-note');
  });

  it('is idempotent — a second run does not duplicate the block', async () => {
    const { runner, getBody } = makeRunner();
    await openSpecPr(target(), 'spec/dep-bump', deps({ runner }));
    const afterFirst = getBody();
    await openSpecPr(target(), 'spec/dep-bump', deps({ runner }));

    expect(getBody()).toBe(afterFirst);
    expect(getBody().match(/## Release metadata/g)).toHaveLength(1);
  });

  it('returns the opened PR when the metadata write-back fails (non-fatal)', async () => {
    const runner: HandoffDeps['runner'] = async (args) => {
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
      throw new Error('gh exploded');
    };
    const result = await openSpecPr(target(), 'spec/dep-bump', deps({ runner }));

    expect(result).toEqual({ kind: 'pr-opened', url: PR_URL });
  });
});
