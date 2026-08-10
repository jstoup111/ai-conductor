// Test: openSpecPr supplies a release disposition ONLY where one is required.
//
// `gh pr create --fill` builds the body from the branch name and last commit
// message, so a spec PR never carries a `## Release metadata` section and a
// repository whose required check parses one fails closed on every landed spec.
// That was repaired by hand five times in one evening (#1435, #1438, #1443,
// #1445, #1446).
//
// The scope boundary is the point of these specs. The release-disposition
// contract belongs to whichever repository configures it — `openSpecPr` runs
// against every repo in the engineer's registry, so a consumer repo that never
// opted in must come out byte-identical to today. Opt-in is read from the target
// repo's own `.github/pull_request_template.md`.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';
import { parseReleaseDisposition } from '../../../src/engine/release-metadata.js';
import { declaresReleaseDisposition } from '../../../src/engine/engineer/release-metadata-inject.js';

const PR_URL = 'https://github.com/acme/app/pull/53';

function makeRunner(initialBody = 'spec: land authored artifacts for "x" [engineer/land]') {
  let body = initialBody;
  const calls: string[][] = [];
  const runner: HandoffDeps['runner'] = async (args) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') {
      return { stdout: JSON.stringify({ body }), stderr: '' };
    }
    if (args[0] === 'pr' && args[1] === 'edit') {
      body = args[args.indexOf('--body') + 1]!;
      return { stdout: '', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { runner, calls, getBody: () => body };
}

let tempDir: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'handoff-relmeta-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Give the temp repo a PR template that declares the contract (opt-in). */
async function optIn(): Promise<void> {
  await mkdir(join(tempDir, '.github'), { recursive: true });
  await writeFile(
    join(tempDir, '.github', 'pull_request_template.md'),
    '## Release metadata\n\nRelease-Disposition: no-note\n',
    'utf-8',
  );
}

function target(): TargetRepo {
  return { name: 'app', canonicalPath: tempDir, remote: 'https://github.com/acme/app.git' };
}

const noOpGitRunner: NonNullable<HandoffDeps['gitRunner']> = async () => ({
  stdout: '',
  stderr: '',
});

function deps(runner: HandoffDeps['runner']): HandoffDeps {
  return {
    runner,
    gitRunner: noOpGitRunner,
    ledgerOpts: { engineerDir: tempDir },
  } as HandoffDeps;
}

describe('declaresReleaseDisposition — repository opt-in', () => {
  it('is false when the repo has no PR template', async () => {
    expect(await declaresReleaseDisposition(tempDir)).toBe(false);
  });

  it('is false when the template exists but declares no disposition', async () => {
    await mkdir(join(tempDir, '.github'), { recursive: true });
    await writeFile(
      join(tempDir, '.github', 'pull_request_template.md'),
      '## What\n\nDescribe the change.\n',
      'utf-8',
    );
    expect(await declaresReleaseDisposition(tempDir)).toBe(false);
  });

  it('is true when the template declares the contract', async () => {
    await optIn();
    expect(await declaresReleaseDisposition(tempDir)).toBe(true);
  });
});

describe('openSpecPr — repos that do NOT require a disposition', () => {
  it('never reads or edits the PR body (byte-identical to prior behavior)', async () => {
    // The regression this guards: stamping a repo-local convention into every
    // consumer repo the engineer targets.
    const { runner, calls, getBody } = makeRunner();
    const before = getBody();

    const result = await openSpecPr(target(), 'spec/consumer', deps(runner));

    expect(result.kind).toBe('pr-opened');
    expect(getBody()).toBe(before);
    expect(calls.filter((a) => a[1] === 'view' || a[1] === 'edit')).toEqual([]);
  });
});

describe('openSpecPr — repos that DO require a disposition', () => {
  it('adds a no-note disposition when the --fill body carries none', async () => {
    await optIn();
    const { runner, getBody } = makeRunner();

    const result = await openSpecPr(target(), 'spec/dep-bump', deps(runner));

    expect(result.kind).toBe('pr-opened');
    // The authoritative assertion is that the real parser accepts the result.
    expect(parseReleaseDisposition(getBody())).toEqual({ disposition: 'no-note' });
  });

  it('injects even when no sourceRef is supplied', async () => {
    // PR #1438 landed with an empty body and no sourceRef, and failed the check.
    await optIn();
    const { runner, getBody } = makeRunner();

    await openSpecPr(target(), 'spec/no-source-ref', deps(runner));

    expect(parseReleaseDisposition(getBody())).toEqual({ disposition: 'no-note' });
  });

  it('never overwrites an author-supplied note disposition', async () => {
    await optIn();
    const authored = [
      '## Release metadata',
      '',
      'Release-Disposition: note',
      'Release-Category: Fixed',
      'Release-Semver: patch',
      'Release-Note: Something reader-facing.',
    ].join('\n');
    const { runner, getBody } = makeRunner(authored);

    await openSpecPr(target(), 'spec/authored', deps(runner));

    expect(parseReleaseDisposition(getBody())).toMatchObject({
      disposition: 'note',
      category: 'Fixed',
      semver: 'patch',
    });
    expect(getBody()).not.toContain('Release-Disposition: no-note');
  });

  it('is idempotent — a second run does not duplicate the block', async () => {
    await optIn();
    const { runner, getBody } = makeRunner();

    await openSpecPr(target(), 'spec/dep-bump', deps(runner));
    const afterFirst = getBody();
    await openSpecPr(target(), 'spec/dep-bump', deps(runner));

    expect(getBody()).toBe(afterFirst);
    expect(getBody().match(/## Release metadata/g)).toHaveLength(1);
  });

  it('returns the opened PR when the metadata write-back fails (non-fatal)', async () => {
    await optIn();
    const runner: HandoffDeps['runner'] = async (args) => {
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
      throw new Error('gh exploded');
    };

    const result = await openSpecPr(target(), 'spec/dep-bump', deps(runner));

    expect(result).toEqual({ kind: 'pr-opened', url: PR_URL });
  });
});
