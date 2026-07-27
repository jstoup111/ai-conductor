import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveShipmentIdentity } from '../../src/engine/shipment-identity.js';
import { dispatchShippedRecord } from '../../src/engine/shipped-record-cli.js';
import { initTestRepo } from '../fixtures/git-repo.js';

describe('resolveShipmentIdentity', () => {
  it('uses the canonical date-prefixed plan stem when feature state holds its unprefixed suffix', () => {
    expect(
      resolveShipmentIdentity('durable-shipped-record-enforcement-and-backfill-916-936', [
        '.docs/plans/2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md',
      ]),
    ).toEqual({
      kind: 'resolved',
      identity: {
        requestedSlug: 'durable-shipped-record-enforcement-and-backfill-916-936',
        slug: '2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936',
        planPath: '.docs/plans/2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md',
        recordPath: '.docs/shipped/2026-07-25-durable-shipped-record-enforcement-and-backfill-916-936.md',
      },
    });
  });

  it('refuses to guess when multiple dated plans share the requested suffix', () => {
    expect(
      resolveShipmentIdentity('feature', [
        '.docs/plans/2026-07-24-feature.md',
        '.docs/plans/2026-07-25-feature.md',
      ]),
    ).toEqual({
      kind: 'ambiguous',
      expected: '.docs/plans/feature.md',
      candidates: [
        '.docs/plans/2026-07-24-feature.md',
        '.docs/plans/2026-07-25-feature.md',
      ],
    });
  });

  it('writes the canonical date-prefixed record when the producer receives the unprefixed feature suffix', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-identity-writer-'));
    const requestedSlug = 'feature';
    const canonicalSlug = '2026-07-25-feature';
    try {
      await initTestRepo(repoDir);
      await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
      await writeFile(join(repoDir, `.docs/plans/${canonicalSlug}.md`), '# Feature\n');
      await dispatchShippedRecord(
        { kind: 'write', slug: requestedSlug, pr: 'https://github.com/acme/conductor/pull/958' },
        repoDir,
      );

      await expect(
        readFile(join(repoDir, `.docs/shipped/${canonicalSlug}.md`), 'utf8'),
      ).resolves.toContain(`slug: ${canonicalSlug}`);
      await expect(
        readFile(join(repoDir, `.docs/shipped/${requestedSlug}.md`), 'utf8'),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(repoDir, { recursive: true, force: true });
    }
  });
});
