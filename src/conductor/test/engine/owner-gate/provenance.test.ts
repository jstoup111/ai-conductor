// Test: owner-gate provenance reader (provenance.ts)
//
// Covers reading the committed `Owner:` stamp from the intake marker:
//   - FR-4 read: `Owner: alice` → { present: true, id: 'alice' } (normalized)
//   - FR-4/12 negative: marker absent (git non-zero), no `Owner:` line, and a
//     whitespace-only value all read as un-owned ({ present: false })

import { describe, it, expect } from 'vitest';
import { readSpecOwnerStamp } from '../../../src/engine/owner-gate/provenance.js';
import type { GitRunner, GitResult } from '../../../src/engine/rebase.js';

interface GitStub {
  git: GitRunner;
  calls: string[][];
}

/** A git stub returning a fixed result, recording the argv it was called with. */
function gitReturning(result: Partial<GitResult>): GitStub {
  const calls: string[][] = [];
  const git: GitRunner = async (args) => {
    calls.push([...args]);
    return { exitCode: 0, stdout: '', stderr: '', ...result };
  };
  return { git, calls };
}

describe('readSpecOwnerStamp', () => {
  it('reads and normalizes the Owner line from the base-branch marker (FR-4)', async () => {
    const { git, calls } = gitReturning({
      stdout: '# Intake origin: my-slug\n\nSource-Ref: acme/app#7\nOwner:  Alice \n',
    });
    await expect(readSpecOwnerStamp(git, 'main', 'my-slug')).resolves.toEqual({
      present: true,
      id: 'alice',
    });
    expect(calls[0]).toEqual(['show', 'main:.docs/intake/my-slug.md']);
  });

  it('reads an absent marker (git non-zero) as un-owned', async () => {
    const { git } = gitReturning({ exitCode: 128, stderr: 'fatal: path does not exist' });
    await expect(readSpecOwnerStamp(git, 'main', 'ghost')).resolves.toEqual({ present: false });
  });

  it('reads a marker with no Owner line as un-owned', async () => {
    const { git } = gitReturning({ stdout: '# Intake origin: x\n\nSource-Ref: acme/app#1\n' });
    await expect(readSpecOwnerStamp(git, 'main', 'x')).resolves.toEqual({ present: false });
  });

  it('reads a blank/whitespace Owner value as un-owned (FR-12)', async () => {
    const { git } = gitReturning({ stdout: 'Owner:    \n' });
    await expect(readSpecOwnerStamp(git, 'main', 'x')).resolves.toEqual({ present: false });
  });
});
