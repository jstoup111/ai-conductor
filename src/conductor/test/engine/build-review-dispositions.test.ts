import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { parseBuildReviewLapId } from '../../src/engine/build-review-domain.js';
import { canonicalizeBuildReviewFindingIdentity } from '../../src/engine/build-review-finding-identity.js';
import {
  BuildReviewDispositionStore,
  matchesBuildReviewDisposition,
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
const finding = canonicalizeBuildReviewFindingIdentity({
  rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
  anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'out-of-plan-change' },
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
      rubric: 'scope', contractVersion: 'v1', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/b.ts', relation: 'out-of-plan-change' },
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
    ['tautology', {
      rubric: 'tautology', contractVersion: 'v3', concernKind: 'assertion-insensitive-to-production',
      anchor: {
        rubric: 'tautology', exercisedBehavior: 'persists state', violationKind: 'assertion-insensitive-to-production',
        changedTest: {
          path: 'test/widget.test.ts',
          contentHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          display: 'widget persists state',
        },
      },
    }],
    ['scope', {
      rubric: 'scope', contractVersion: 'v3', concernKind: 'out-of-plan-change',
      anchor: { rubric: 'scope', path: 'src/a.ts', relation: 'not-authorized-by-plan' },
    }],
    ['rootCause', {
      rubric: 'rootCause', contractVersion: 'v3', concernKind: 'root-cause-unaddressed',
      anchor: {
        rubric: 'rootCause', statedDefect: 'state is not persisted', relation: 'root-cause-unaddressed',
        locus: {
          path: 'src/handler.ts',
          contentHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
          display: 'persistence return branch',
        },
      },
    }],
    ['completeness', {
      rubric: 'completeness', contractVersion: 'v3', concernKind: 'missing-deliverable',
      anchor: { rubric: 'completeness', planTask: '11', missingSurface: 'src/state.ts', missingOutcome: 'writes state', missingKind: 'missing-deliverable' },
    }],
  ] as const;

  // Regression for #1769: the store validated an engine-produced canonical
  // payload with the grader-facing anchor parser, so only `scope` — whose
  // canonical anchor happens to equal its grader anchor — could be accepted.
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
      finding: { ...engineIdentity, canonicalPayload: { ...engineIdentity.canonicalPayload, anchor: { rubric: 'tautology', violationKind: 'source-text-mirror' } } as never },
    });

    expect(forgedId).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(forgedJson).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(forgedPayload).toEqual({ ok: false, kind: 'invalid', message: 'build-review disposition input is invalid' });
    expect(filesystem.writes).toEqual([]);
  });

  it('keeps a stored disposition matched when the same finding is re-reported with drifted prose', () => {
    const original = canonicalizeBuildReviewFindingIdentity(currentContractFindings[2][1])!;
    const reReported = canonicalizeBuildReviewFindingIdentity({
      ...currentContractFindings[2][1],
      anchor: {
        ...currentContractFindings[2][1].anchor,
        statedDefect: 'a differently worded account of the same defect',
        locus: { ...currentContractFindings[2][1].anchor.locus, display: 'persistence return branch after rebase' },
      },
    })!;
    const accepted: BuildReviewDispositionRecord = {
      version: 'v1', feature, finding: original, sourceLapId: parseBuildReviewLapId('lap-7')!,
      summary: 'summary', rationale: 'reason', operator: 'james', acceptedAt: '2026-08-21T12:00:00.000Z',
    };

    expect(matchesBuildReviewDisposition(feature, reReported, [accepted])).toBe(true);
  });
});
