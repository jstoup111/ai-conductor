import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readRemediationPlan,
  readRemediationPlanResult,
  renderRemediationPlanAbsence,
} from '../../src/engine/artifacts.js';

const dirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'remediation-plan-absence-'));
  dirs.push(dir);
  await mkdir(join(dir, '.pipeline'), { recursive: true });
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('remediation plan absence causes', () => {
  it('distinguishes absent, stale, unparseable, and non-array plans while preserving the nullable wrapper', async () => {
    const dir = await fixture();
    const path = join(dir, '.pipeline', 'remediation.json');
    const sessionStartedAt = Date.now() - 1_000;

    await expect(readRemediationPlanResult(dir, sessionStartedAt)).resolves.toEqual({ plan: null, cause: 'absent' });
    await expect(readRemediationPlan(dir, sessionStartedAt)).resolves.toBeNull();

    await writeFile(path, '{"dispositions": []}');
    await utimes(path, new Date(sessionStartedAt - 1_000), new Date(sessionStartedAt - 1_000));
    await expect(readRemediationPlanResult(dir, sessionStartedAt)).resolves.toEqual({ plan: null, cause: 'stale' });

    await writeFile(path, '{bad json');
    await expect(readRemediationPlanResult(dir, sessionStartedAt)).resolves.toEqual({ plan: null, cause: 'unparseable' });

    await writeFile(path, JSON.stringify({ dispositions: {} }));
    await expect(readRemediationPlanResult(dir, sessionStartedAt)).resolves.toEqual({
      plan: null,
      cause: 'non-array-dispositions',
    });
  });

  it('returns a valid fresh plan and renders every absence cause', async () => {
    const dir = await fixture();
    await writeFile(join(dir, '.pipeline', 'remediation.json'), JSON.stringify({
      dispositions: [{ id: 'AB-1', disposition: 'build', tasks: [{ id: '1', title: 'Fix it' }] }],
    }));

    await expect(readRemediationPlanResult(dir, Date.now() - 1_000)).resolves.toMatchObject({
      plan: { gaps: [{ id: 'AB-1', disposition: 'build' }] },
    });
    expect(renderRemediationPlanAbsence('absent')).toBe('the planner wrote no remediation plan');
    expect(renderRemediationPlanAbsence('stale')).toContain('stale');
    expect(renderRemediationPlanAbsence('unparseable')).toContain('not valid JSON');
    expect(renderRemediationPlanAbsence('non-array-dispositions')).toContain('no dispositions array');
    expect(renderRemediationPlanAbsence('no-routable-dispositions')).toContain('no routable dispositions');
  });

  it.each([
    ['an empty array', []],
    ['non-object entries', [null, 'not an object', 42]],
    ['a halt without a category', [{ id: 'AB-1', disposition: 'halt' }]],
    ['an existing-task disposition with a blank task id', [{
      id: 'AB-1',
      disposition: 'existing-task',
      tasks: [{ id: '  ', title: 'Already planned work' }],
    }]],
  ])('reports no-routable-dispositions for %s', async (_description, dispositions) => {
    const dir = await fixture();
    await writeFile(
      join(dir, '.pipeline', 'remediation.json'),
      JSON.stringify({ dispositions }),
    );

    await expect(readRemediationPlanResult(dir, Date.now() - 1_000)).resolves.toEqual({
      plan: null,
      cause: 'no-routable-dispositions',
    });
    await expect(readRemediationPlan(dir, Date.now() - 1_000)).resolves.toBeNull();
  });
});
