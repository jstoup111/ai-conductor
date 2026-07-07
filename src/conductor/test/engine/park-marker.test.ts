import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  writeAutoPark,
  isOperatorParked,
  getProvenanceType,
  writeOperatorPark,
} from '../../src/engine/park-marker';

let repoPath: string;

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'park-marker-'));
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('park-marker auto-park provenance (Task 22)', () => {
  it('writeAutoPark() creates .daemon/parked/<slug> with auto-parked: <reason> body', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);

    const content = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');
    expect(content).toContain('auto-parked: No evidence after 3 attempts');
  });

  it('writeAutoPark() includes ISO-8601 timestamp in marker body', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);

    const content = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');
    expect(content).toContain('timestamp:');

    // Verify it's a valid ISO-8601 timestamp
    const timestampMatch = content.match(/timestamp:\s*(.+)/);
    expect(timestampMatch).toBeTruthy();
    if (timestampMatch) {
      const timestamp = timestampMatch[1].trim();
      expect(() => new Date(timestamp)).not.toThrow();
      expect(Number.isNaN(Date.parse(timestamp))).toBe(false);
    }
  });

  it('isOperatorParked() returns true for auto-parked marker (backward compatible)', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'No evidence after 3 attempts');

    const isParked = await isOperatorParked(repoPath, slug);
    expect(isParked).toBe(true);
  });

  it('getProvenanceType() returns "auto" for auto-parked markers', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'No evidence after 3 attempts');

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe('auto');
  });

  it('getProvenanceType() returns "operator" for operator-parked markers', async () => {
    const slug = 'my-feature';

    await writeOperatorPark(repoPath, slug);

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe('operator');
  });

  it('getProvenanceType() returns null when marker does not exist', async () => {
    const slug = 'nonexistent';

    const provenance = await getProvenanceType(repoPath, slug);
    expect(provenance).toBe(null);
  });

  it('writeAutoPark() is idempotent — same reason twice produces identical file', async () => {
    const slug = 'my-feature';
    const reason = 'No evidence after 3 attempts';

    await writeAutoPark(repoPath, slug, reason);
    const firstWrite = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Small delay to ensure any timestamp would differ
    await new Promise((resolve) => setTimeout(resolve, 10));

    await writeAutoPark(repoPath, slug, reason);
    const secondWrite = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    expect(firstWrite).toBe(secondWrite);
  });

  it('writeAutoPark() with different reason overwrites on idempotent re-write attempt', async () => {
    const slug = 'my-feature';

    await writeAutoPark(repoPath, slug, 'First reason');
    const firstContent = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Try to write with a different reason — should be idempotent (no change)
    await writeAutoPark(repoPath, slug, 'Second reason');
    const secondContent = await readFile(join(repoPath, '.daemon', 'parked', slug), 'utf-8');

    // Content should be identical (idempotent)
    expect(secondContent).toBe(firstContent);
    expect(secondContent).toContain('First reason');
    expect(secondContent).not.toContain('Second reason');
  });
});
