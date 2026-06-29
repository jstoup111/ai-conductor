// Test: openSpecPr links the spec PR to its issue with a NON-CLOSING Refs (FR-2).
//
// When a sourceRef is supplied, openSpecPr (after creating the PR) edits the PR
// body to add `Refs owner/repo#N` — never a closing keyword (the issue must stay
// open until the daemon's implementation PR merges). Absent sourceRef → today's
// behavior (no edit). Injection is idempotent and non-fatal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openSpecPr } from '../../../src/engine/engineer/handoff.js';
import type { HandoffDeps } from '../../../src/engine/engineer/handoff.js';
import type { TargetRepo } from '../../../src/engine/engineer/target.js';

interface Call {
  args: string[];
  cwd: string;
}

/**
 * Args-aware fake gh runner:
 *   pr create → prints the PR URL
 *   pr view   → returns the current (mutable) body as JSON
 *   pr edit   → records the new body
 */
function makeRunner(initialBody = '## Why\nstuff') {
  const calls: Call[] = [];
  let body = initialBody;
  const PR_URL = 'https://github.com/acme/app/pull/53';
  const runner: HandoffDeps['runner'] = async (args, opts) => {
    calls.push({ args: [...args], cwd: opts?.cwd ?? '' });
    if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
    if (args[0] === 'pr' && args[1] === 'view') return { stdout: JSON.stringify({ body }), stderr: '' };
    if (args[0] === 'pr' && args[1] === 'edit') {
      body = args[args.indexOf('--body') + 1];
      return { stdout: '', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  };
  return { runner, calls, getBody: () => body, PR_URL };
}

let tempDir: string;
beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'handoff-ref-'));
});
afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

function target(): TargetRepo {
  return { name: 'app', canonicalPath: tempDir };
}

describe('openSpecPr — spec PR issue linkage (FR-2)', () => {
  it('adds a non-closing Refs line when sourceRef is supplied', async () => {
    const { runner, getBody } = makeRunner();
    const result = await openSpecPr(target(), 'spec/dep-bump', {
      runner,
      ledgerOpts: { engineerDir: tempDir },
      sourceRef: 'acme/app#49',
    });
    expect(result.kind).toBe('pr-opened');
    expect(getBody()).toContain('Refs acme/app#49');
    // Never a closing keyword — the issue must not close on spec merge.
    expect(getBody()).not.toMatch(/\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b/i);
  });

  it('does NOT edit the PR body when no sourceRef is supplied (unchanged behavior)', async () => {
    const { runner, calls } = makeRunner();
    const result = await openSpecPr(target(), 'spec/dep-bump', {
      runner,
      ledgerOpts: { engineerDir: tempDir },
    });
    expect(result.kind).toBe('pr-opened');
    expect(calls.some((c) => c.args[1] === 'edit')).toBe(false);
  });

  it('is idempotent — re-running does not duplicate the Refs line', async () => {
    const { runner, getBody } = makeRunner('## Why\nstuff\n\nRefs acme/app#49');
    await openSpecPr(target(), 'spec/dep-bump', {
      runner,
      ledgerOpts: { engineerDir: tempDir },
      sourceRef: 'acme/app#49',
    });
    expect(getBody().match(/Refs acme\/app#49/g)).toHaveLength(1);
  });

  it('returns the opened PR even when the body edit fails (non-fatal)', async () => {
    const PR_URL = 'https://github.com/acme/app/pull/53';
    const runner: HandoffDeps['runner'] = async (args) => {
      if (args[0] === 'pr' && args[1] === 'create') return { stdout: `${PR_URL}\n`, stderr: '' };
      throw new Error('gh: API rate limit exceeded'); // view/edit blow up
    };
    const result = await openSpecPr(target(), 'spec/dep-bump', {
      runner,
      ledgerOpts: { engineerDir: tempDir },
      sourceRef: 'acme/app#49',
    });
    expect(result.kind).toBe('pr-opened');
    if (result.kind === 'pr-opened') expect(result.url).toBe(PR_URL);
  });
});
