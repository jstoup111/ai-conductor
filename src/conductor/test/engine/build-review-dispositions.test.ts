// Covers: task:26
import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import {
  canonicalizeBuildReviewFindingIdentity,
  stampBuildReviewCustomJudgedResult,
} from '../../src/engine/build-review-finding-identity.js';
import { renderBuildReviewAcceptedRisk } from '../../src/engine/build-review-accepted-risk.js';
import {
  BuildReviewDispositionStore,
  matchesBuildReviewDisposition,
  matchesBuildReviewReducedCoverageDisposition,
  type BuildReviewReducedCoverageDispositionRecord,
  type BuildReviewDispositionFilesystem,
  type BuildReviewDispositionRecord,
} from '../../src/engine/build-review-dispositions.js';
import type { ConductStateLease } from '../../src/engine/conduct-state-lease.js';

class MemoryFilesystem implements BuildReviewDispositionFilesystem {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly renames: Array<readonly [string, string]> = [];

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return value;
  }

  async mkdir(): Promise<void> {}

  async writeFile(path: string, contents: string): Promise<void> {
    this.writes.push(path);
    this.files.set(path, contents);
  }

  async rename(from: string, to: string): Promise<void> {
    const contents = await this.readFile(from);
    this.renames.push([from, to]);
    this.files.set(to, contents);
    this.files.delete(from);
  }
}

function lock(result: Awaited<ReturnType<ConductStateLease['acquire']>>): ConductStateLease {
  return { acquire: async () => result };
}

const feature = { version: 'v1' as const, repository: 'github.com/acme/conductor', feature: 'review-rubrics' };
const otherFeature = { ...feature, feature: 'other-feature' };
const testContentHash = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const finding = canonicalizeBuildReviewFindingIdentity({
  rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
  anchor: { rubric: 'testQuality', locus: { path: 'test/engine/build-review-dispositions.test.ts', contentHash: testContentHash, display: 'fixture test' } },
})!;

describe('build-review dispositions', () => {
  it('persists the versioned feature, complete canonical finding, lap, rationale, operator, and clock time', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, clock: () => Date.parse('2026-08-14T12:00:00.000Z'),
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    const appended = await store.append({
      feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'src/a.ts is not planned',
      rationale: 'Accepted temporary migration risk', operator: 'james',
    });

    expect(appended).toEqual({
      ok: true,
      record: expect.objectContaining({
        version: 'v1', feature, finding, sourceLapId: 'lap-7', summary: 'src/a.ts is not planned',
        rationale: 'Accepted temporary migration risk', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
      }),
    });
    await expect(store.list(feature)).resolves.toMatchObject({ ok: true, records: [expect.objectContaining({ finding })] });
    await expect(store.list(otherFeature)).resolves.toEqual({ ok: true, records: [] });
  });

  it('reads a stored v1 canonical finding record without treating the disposition state as malformed', async () => {
    const filesystem = new MemoryFilesystem();
    filesystem.files.set('/repo/.pipeline/build-review-dispositions.json', JSON.stringify({
      version: 'v1',
      records: [{
        version: 'v1', feature, finding, sourceLapId: 'lap-7', summary: 'stored before contract v2',
        rationale: 'accepted migration risk', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
      }],
    }));
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(store.list(feature)).resolves.toEqual({
      ok: true,
      records: [expect.objectContaining({ finding, summary: 'stored before contract v2' })],
    });
  });

  it('reloads restored legacy state after a linked worktree is recreated without creating coverage', async () => {
    const main = await mkdtemp(join(tmpdir(), 'build-review-dispositions-main-'));
    const recreatedWorktree = join(main, '.worktrees', 'feature');
    const legacyState = JSON.stringify({
      version: 'v1',
      records: [{
        version: 'v1', feature, finding, sourceLapId: 'lap-7', summary: 'legacy finding',
        rationale: 'accepted migration risk', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
      }],
    });
    try {
      await mkdir(join(recreatedWorktree, '.pipeline'), { recursive: true });
      await writeFile(join(recreatedWorktree, '.pipeline', 'build-review-dispositions.json'), legacyState);
      await expect(new BuildReviewDispositionStore(recreatedWorktree).list(feature)).resolves.toMatchObject({
        ok: true, records: [expect.objectContaining({ finding })],
      });

      await rm(recreatedWorktree, { recursive: true, force: true });
      await mkdir(join(recreatedWorktree, '.pipeline'), { recursive: true });
      await writeFile(join(recreatedWorktree, '.pipeline', 'build-review-dispositions.json'), legacyState);
      const reloaded = await new BuildReviewDispositionStore(recreatedWorktree).listReducedCoverage(feature);
      expect(reloaded).toEqual({ ok: true, records: [] });
    } finally {
      await rm(main, { recursive: true, force: true });
    }
  });

  it('ignores a retired reduced-coverage record before strict decoding current records', async () => {
    const filesystem = new MemoryFilesystem();
    filesystem.files.set('/repo/.pipeline/build-review-dispositions.json', JSON.stringify({
      version: 'v1',
      records: [{
        kind: 'reduced-coverage', version: 'v1', feature,
        identity: { rubric: 'scope', reason: 'provider-error' },
        rationale: 'accepted before rubric retirement', operator: 'james',
        acceptedAt: '2026-08-21T12:00:00.000Z',
      }],
    }));
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(store.listReducedCoverage(feature)).resolves.toEqual({ ok: true, records: [] });
  });

  it('ignores a persisted tautology disposition from before the rubric retirement', async () => {
    const filesystem = new MemoryFilesystem();
    filesystem.files.set('/repo/.pipeline/build-review-dispositions.json', JSON.stringify({
      version: 'v1',
      records: [{
        kind: 'reduced-coverage', version: 'v1', feature,
        identity: { rubric: 'tautology', reason: 'provider-error' },
        rationale: 'accepted before rubric retirement', operator: 'james',
        acceptedAt: '2026-08-21T12:00:00.000Z',
      }],
    }));
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(store.listReducedCoverage(feature)).resolves.toEqual({ ok: true, records: [] });
  });

  it('durably stores a reduced-coverage decision by its closed rubric-and-cause identity independent of the aggregate', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, clock: () => Date.parse('2026-08-19T12:00:00.000Z'),
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    const appended = await store.appendReducedCoverageIfCurrent({
      feature, rubric: 'testQuality', reason: 'preflight-failed',
      rationale: 'The merge-base fixture is unavailable in this worktree.', operator: 'james',
    }, async () => true);

    expect(appended).toEqual({
      ok: true,
      record: expect.objectContaining({
        kind: 'reduced-coverage', version: 'v1', feature,
        identity: { rubric: 'testQuality', reason: 'preflight-failed' },
        rationale: 'The merge-base fixture is unavailable in this worktree.',
        operator: 'james', acceptedAt: '2026-08-19T12:00:00.000Z',
      }),
    });
    expect((appended as { record: BuildReviewReducedCoverageDispositionRecord }).record.identity)
      .toEqual({ rubric: 'testQuality', reason: 'preflight-failed' });

    filesystem.files.set('/repo/.pipeline/build-review.json', '{"stale":true}');
    filesystem.files.delete('/repo/.pipeline/build-review.json');
    const freshProcessStore = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(freshProcessStore.listReducedCoverage(feature)).resolves.toEqual({
      ok: true,
      records: [expect.objectContaining({
        kind: 'reduced-coverage', identity: { rubric: 'testQuality', reason: 'preflight-failed' },
      })],
    });
  });

  it('admits scope-incomplete as a closed reduced-coverage cause under the existing lease', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, clock: () => Date.parse('2026-09-06T12:00:00.000Z'),
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(store.appendReducedCoverageIfCurrent({
      feature, rubric: 'testQuality', reason: 'scope-incomplete',
      rationale: 'The scope binding is incomplete.', operator: 'james',
    }, async () => true)).resolves.toMatchObject({
      ok: true, record: { identity: { rubric: 'testQuality', reason: 'scope-incomplete' }, operator: 'james' },
    });
  });

  it('persists declaration-scoped custom coverage without package or execution identity', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });
    const declaration = {
      version: 'v1' as const, rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
      question: 'Does this preserve the portable policy contract?', source: 'project' as const, resources: ['criteria.md'],
    };
    const appended = await store.appendReducedCoverageIfCurrent({
      feature, declaration, reason: 'policy-load-failed', rationale: 'The policy cannot be loaded.', operator: 'james',
    }, async () => true);
    const listed = await store.listReducedCoverage(feature);
    const records = listed.ok ? listed.records : [];
    const invalid = await store.appendReducedCoverageIfCurrent({
      feature,
      declaration: { ...declaration, resources: [''] },
      reason: 'policy-load-failed', rationale: 'invalid declaration', operator: 'james',
    }, async () => true);

    expect({
      appended,
      invalid,
      exact: matchesBuildReviewReducedCoverageDisposition(feature, { declaration, reason: 'policy-load-failed' }, records),
      changedQuestion: matchesBuildReviewReducedCoverageDisposition(feature, { declaration: { ...declaration, question: 'Does this preserve the revised portable policy contract?' }, reason: 'policy-load-failed' }, records),
      changedReason: matchesBuildReviewReducedCoverageDisposition(feature, { declaration, reason: 'provider-error' }, records),
    }).toMatchObject({ appended: { ok: true }, invalid: { ok: false, kind: 'invalid' }, exact: true, changedQuestion: false, changedReason: false });
  });

  it('refuses blank rationales without writing a reduced-coverage decision', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(store.appendReducedCoverageIfCurrent({
      feature, rubric: 'testQuality', reason: 'preflight-failed', rationale: '   ', operator: 'james',
    }, async () => true)).resolves.toMatchObject({ ok: false, kind: 'invalid' });

    expect(filesystem.writes).toEqual([]);
    await expect(store.listReducedCoverage(feature)).resolves.toEqual({ ok: true, records: [] });
  });

  it('keeps reduced-coverage state unchanged when current-state validation or duplicate protection refuses it', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });
    const input = {
      feature, rubric: 'testQuality' as const, reason: 'preflight-failed' as const, rationale: 'reason', operator: 'james',
    };

    await expect(store.appendReducedCoverageIfCurrent(input, async () => false)).resolves.toMatchObject({ ok: false, kind: 'invalid' });
    expect(filesystem.writes).toEqual([]);

    await expect(store.appendReducedCoverageIfCurrent(input, async () => true)).resolves.toMatchObject({ ok: true });
    const writesBeforeDuplicate = filesystem.writes.length;
    await expect(store.appendReducedCoverageIfCurrent(input, async () => true)).resolves.toMatchObject({ ok: false, kind: 'invalid' });
    expect(filesystem.writes).toHaveLength(writesBeforeDuplicate);
  });

  it('refuses unreadable or unwritable reduced-coverage state so the review remains blocking', async () => {
    const filesystem = new MemoryFilesystem();
    filesystem.files.set('/repo/.pipeline/build-review-dispositions.json', '{broken');
    const unreadable = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });
    const input = {
      feature, rubric: 'testQuality' as const, reason: 'preflight-failed' as const, rationale: 'reason', operator: 'james',
    };

    await expect(unreadable.appendReducedCoverageIfCurrent(input, async () => true)).resolves.toMatchObject({ ok: false, kind: 'unreadable' });
    expect(filesystem.writes).toEqual([]);

    const unwritableFilesystem = new MemoryFilesystem();
    unwritableFilesystem.writeFile = async () => { throw new Error('read-only filesystem'); };
    const unwritable = new BuildReviewDispositionStore('/repo', {
      filesystem: unwritableFilesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await expect(unwritable.appendReducedCoverageIfCurrent(input, async () => true)).resolves.toMatchObject({ ok: false, kind: 'filesystem' });
    await expect(unwritable.listReducedCoverage(feature)).resolves.toEqual({ ok: true, records: [] });
  });

  it('uses same-directory temporary replacement only after acquiring the shared lock', async () => {
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    await store.append({ feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james' });

    expect(filesystem.writes).toEqual([expect.stringMatching(/\.tmp$/)]);
    expect(filesystem.renames).toEqual([[expect.stringMatching(/\.tmp$/), '/repo/.pipeline/build-review-dispositions.json']]);
  });

  it('fails closed when the bounded lock cannot be acquired or the state is unreadable', async () => {
    const filesystem = new MemoryFilesystem();
    const blocked = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: false, kind: 'timeout', message: 'occupied' }),
    });
    const input = { feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james' };

    await expect(blocked.append(input)).resolves.toEqual({ ok: false, kind: 'lock', message: 'occupied' });
    filesystem.files.set('/repo/.pipeline/build-review-dispositions.json', '{broken');
    const readable = new BuildReviewDispositionStore('/repo', {
      filesystem,
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });
    await expect(readable.list(feature)).resolves.toMatchObject({ ok: false, kind: 'unreadable' });
  });

  it('reclaims a provably stale lock owner before writing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'build-review-dispositions-'));
    const statePath = join(root, '.pipeline', 'build-review-dispositions.json');
    const leasePath = `${statePath}.lease`;
    try {
      await mkdir(leasePath, { recursive: true });
      await writeFile(join(leasePath, 'owner.json'), `${JSON.stringify({
        version: 1, pid: 999, token: 'stale-owner', acquiredAt: '2026-08-14T11:00:00.000Z',
      })}\n`);
      const store = new BuildReviewDispositionStore(root, {
        clock: () => Date.parse('2026-08-14T12:00:00.000Z'),
        leaseOptions: { pid: 1000, newToken: () => 'recovery-token', processIsLive: () => false },
      });

      await expect(store.append({
        feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james',
      })).resolves.toMatchObject({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('matches only the complete canonical payload, not a finding ID by itself', () => {
    const accepted: BuildReviewDispositionRecord = {
      version: 'v1', feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!,
      summary: 'Earlier wording at src/a.ts:8', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-14T12:00:00.000Z',
    };
    const changed = canonicalizeBuildReviewFindingIdentity({
      rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
      anchor: { rubric: 'testQuality', locus: { path: 'test/engine/other.test.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', display: 'other test' } },
    })!;

    expect(matchesBuildReviewDisposition(feature, finding, [accepted])).toBe(true);
    expect(matchesBuildReviewDisposition(feature, { ...changed, id: finding.id }, [accepted])).toBe(false);
  });

  it('serializes aggregate publication and current-lap acceptance on one bounded lease', async () => {
    const filesystem = new MemoryFilesystem();
    let occupied = false;
    let notifyAvailable: (() => void) | undefined;
    const lease: ConductStateLease = {
      acquire: async () => {
        while (occupied) await new Promise<void>((resolve) => { notifyAvailable = resolve; });
        occupied = true;
        return { ok: true, handle: { release: async () => {
          occupied = false;
          notifyAvailable?.();
          return { ok: true };
        } } };
      },
    };
    const store = new BuildReviewDispositionStore('/repo', { filesystem, lock: lease });
    let releasePublication: (() => void) | undefined;
    let publicationStarted: (() => void) | undefined;
    const publication = store.withLease(async () => {
      publicationStarted?.();
      await new Promise<void>((resolve) => { releasePublication = resolve; });
    });
    await new Promise<void>((resolve) => { publicationStarted = resolve; });
    const validate = vi.fn(async () => true);
    const acceptance = store.appendIfCurrent({
      feature, finding, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james',
    }, validate);

    await Promise.resolve();
    expect(validate).not.toHaveBeenCalled();
    releasePublication?.();
    await expect(publication).resolves.toMatchObject({ ok: true });
    await expect(acceptance).resolves.toMatchObject({ ok: true });
    expect(validate).toHaveBeenCalledOnce();
  });

  const currentContractFindings = [
    ['testQuality', {
      rubric: 'testQuality', contractVersion: 'v3', concernKind: 'test-insensitive',
      anchor: {
        rubric: 'testQuality',
        locus: {
          path: 'test/widget.test.ts',
          contentHash: testContentHash,
          display: 'widget persists state',
        },
      },
    }],
  ] as const;

  // Regression for #1769: the store validated an engine-produced canonical
  // payload with the grader-facing anchor parser.  The store must instead
  // validate the engine-produced canonical anchor on its own schema.
  it.each(currentContractFindings)('accepts, persists, and re-matches an engine-produced %s identity', async (_rubric, input) => {
    const engineIdentity = canonicalizeBuildReviewFindingIdentity(input)!;
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, clock: () => Date.parse('2026-08-21T12:00:00.000Z'),
      lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    const appended = await store.appendIfCurrent({
      feature, finding: engineIdentity, sourceLapId: parseBuildReviewLapId('lap-7')!,
      summary: 'summary', rationale: 'accepted risk', operator: 'james',
    }, async () => true);
    const listed = await store.list(feature);

    expect(appended).toMatchObject({ ok: true, record: { finding: engineIdentity } });
    expect(listed).toMatchObject({ ok: true, records: [{ finding: engineIdentity }] });
    expect(matchesBuildReviewDisposition(feature, engineIdentity, listed.ok ? listed.records : [])).toBe(true);
  });

  it('still refuses an identity whose id or canonical JSON disagrees with its payload', async () => {
    const engineIdentity = canonicalizeBuildReviewFindingIdentity(currentContractFindings[0][1])!;
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });
    const input = {
      feature, sourceLapId: parseBuildReviewLapId('lap-7')!, summary: 'summary', rationale: 'reason', operator: 'james',
    };

    const forgedId = await store.append({ ...input, finding: { ...engineIdentity, id: 'sha256:0000000000000000000000000000000000000000000000000000000000000000' } });
    const forgedJson = await store.append({ ...input, finding: { ...engineIdentity, canonicalJson: '{}' } });
    const forgedPayload = await store.append({
      ...input,
      finding: { ...engineIdentity, canonicalPayload: { ...engineIdentity.canonicalPayload, anchor: { rubric: 'testQuality', locus: { path: 'test/widget.test.ts', contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } } } as never },
    });

    expect(forgedId).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(forgedJson).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(forgedPayload).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(filesystem.writes).toEqual([]);
  });

  it('keeps a stored disposition matched when the same finding is re-reported with drifted prose', () => {
    const original = canonicalizeBuildReviewFindingIdentity(currentContractFindings[0][1])!;
    const reReported = canonicalizeBuildReviewFindingIdentity({
      ...currentContractFindings[0][1],
      anchor: {
        ...currentContractFindings[0][1].anchor,
        locus: { ...currentContractFindings[0][1].anchor.locus, display: 'widget persists state after rebase' },
      },
    })!;
    const accepted: BuildReviewDispositionRecord = {
      version: 'v1', feature, finding: original, sourceLapId: parseBuildReviewLapId('lap-7')!,
      summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-21T12:00:00.000Z',
    };

    expect(matchesBuildReviewDisposition(feature, reReported, [accepted])).toBe(true);
  });

  it('persists and matches accepted custom risk only for the exact judged declaration and content', async () => {
    const judged = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
        evidenceLocations: ['src/widget.ts:8'],
        sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
      }],
    }, {
      rubric: 'portablePolicy', lapId: 'lap-7',
      declaration: {
        version: 'v1', rubricId: 'portablePolicy', semanticSkill: 'portable-policy',
        question: 'Does this preserve the portable policy contract?', source: 'project', resources: ['criteria.md'],
      },
      policy: { version: 'v1', bundleDigest: `sha256:${'b'.repeat(64)}` },
      candidate: { provider: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
      reviewedInput: { version: 'v1', contentDigest: `sha256:${'c'.repeat(64)}` },
    }, {
      sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
    })!;
    const reReported = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId: 'portable-policy-gap', summary: 'Reworded report.', confidence: 99,
        evidenceLocations: ['src/widget.ts:12'],
        sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'reworded boundary' }],
      }],
    }, { ...judged, lapId: 'lap-8' }, {
      sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
    })!;
    const changedContent = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
        evidenceLocations: ['src/widget.ts:8'],
        sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
      }],
    }, {
      ...judged,
      lapId: 'lap-8',
      policy: { version: 'v1', bundleDigest: `sha256:${'d'.repeat(64)}` },
    }, {
      sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
    })!;
    const changedDeclaration = stampBuildReviewCustomJudgedResult({
      kind: 'custom-findings', version: 'v1', findings: [{
        concernId: 'portable-policy-gap', summary: 'The changed boundary lacks compatibility evidence.',
        evidenceLocations: ['src/widget.ts:8'],
        sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
      }],
    }, {
      ...judged,
      lapId: 'lap-9',
      declaration: { ...judged.declaration, question: 'Does this preserve the revised portable policy contract?' },
    }, {
      sourceRegions: [{ path: 'src/widget.ts', startLine: 8, endLine: 12, contentHash: testContentHash, display: 'public boundary' }],
    })!;
    const filesystem = new MemoryFilesystem();
    const store = new BuildReviewDispositionStore('/repo', {
      filesystem, lock: lock({ ok: true, handle: { release: async () => ({ ok: true }) } }),
    });

    const appended = await store.append({
      feature, finding: judged.findings[0].identity, sourceLapId: parseBuildReviewLapId('lap-7')!,
      summary: judged.findings[0].summary, rationale: 'accepted risk', operator: 'james',
    });
    const listed = await store.list(feature);
    const records = listed.ok ? listed.records : [];

    expect(appended).toMatchObject({ ok: true, record: { finding: judged.findings[0].identity } });
    expect(matchesBuildReviewDisposition(feature, judged.findings[0].identity, records)).toBe(true);
    expect(matchesBuildReviewDisposition(feature, reReported.findings[0].identity, records)).toBe(true);
    expect(matchesBuildReviewDisposition(feature, changedContent.findings[0].identity, records)).toBe(false);
    expect(matchesBuildReviewDisposition(feature, changedDeclaration.findings[0].identity, records)).toBe(false);
    expect(renderBuildReviewAcceptedRisk(records)).toMatchObject({ ok: true, section: expect.stringContaining(judged.findings[0].identity.id) });
  });
});
