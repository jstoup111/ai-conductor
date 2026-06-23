import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  computeAndWriteVerdict,
  readAllVerdicts,
  readVerdict,
  writeVerdict,
} from '../../src/engine/gate-verdicts.js';

describe('engine/gate-verdicts', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'gate-verdicts-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('write + read roundtrip', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 123 });
    const v = await readVerdict(dir, 'build');
    expect(v?.satisfied).toBe(true);
    expect(v?.checkedAt).toBe(123);
  });

  it('readVerdict returns null when absent', async () => {
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('readVerdict returns null on malformed JSON', async () => {
    await mkdir(join(dir, '.pipeline/gates'), { recursive: true });
    await writeFile(join(dir, '.pipeline/gates/plan.json'), 'not json');
    expect(await readVerdict(dir, 'plan')).toBeNull();
  });

  it('computeAndWriteVerdict persists the predicate result', async () => {
    // build with no task-status.json → predicate reports not done
    const v = await computeAndWriteVerdict(dir, 'build');
    expect(v.satisfied).toBe(false);
    expect(v.reason).toMatch(/task-status/);
    const onDisk = await readVerdict(dir, 'build');
    expect(onDisk?.satisfied).toBe(false);
    expect(onDisk?.checkedAt).toBeTypeOf('number');
  });

  it('readAllVerdicts returns every persisted gate', async () => {
    await writeVerdict(dir, 'build', { satisfied: true, checkedAt: 1 });
    await writeVerdict(dir, 'plan', { satisfied: false, reason: 'x', checkedAt: 2 });
    const all = await readAllVerdicts(dir);
    expect(Object.keys(all).sort()).toEqual(['build', 'plan']);
    expect(all.plan?.satisfied).toBe(false);
  });

  it('preserves kickback provenance', async () => {
    await writeVerdict(dir, 'plan', {
      satisfied: false,
      checkedAt: 5,
      kickback: { from: 'build', evidence: 'AC-7 needs a new table' },
    });
    const v = await readVerdict(dir, 'plan');
    expect(v?.kickback?.from).toBe('build');
    expect(v?.kickback?.evidence).toMatch(/AC-7/);
  });
});
