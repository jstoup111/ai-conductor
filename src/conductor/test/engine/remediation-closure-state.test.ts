// Covers: task:1
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  markRemediationClosureApplied,
  readRemediationClosureState,
  recordRemediationClosureVerdicts,
} from '../../src/engine/remediation-closure-state.js';

const temporaryDirectories: string[] = [];

async function createProjectRoot(): Promise<string> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'remediation-closure-state-'));
  temporaryDirectories.push(projectRoot);
  await mkdir(join(projectRoot, '.pipeline'));
  return projectRoot;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe('remediation closure state', () => {
  it('reads an absent section as empty state with zero reopen counts', async () => {
    const projectRoot = await createProjectRoot();

    await expect(readRemediationClosureState(projectRoot)).resolves.toEqual({
      kind: 'present',
      state: { version: 1, plans: {} },
    });
  });

  it.each([
    ['an unknown version', { version: 2, plans: {} }],
    ['a non-integer reopen count', { version: 1, plans: { 'plan.md': { tasks: { rem: { reopenCount: 1.5, verdicts: {} } } } } }],
    ['a negative reopen count', { version: 1, plans: { 'plan.md': { tasks: { rem: { reopenCount: -1, verdicts: {} } } } } }],
    ['an unknown verdict', { version: 1, plans: { 'plan.md': { tasks: { rem: { reopenCount: 0, verdicts: { close: { verdict: 'unknown', rationale: 'reason', disposition: 'left-closed', applied: false } } } } } } }],
    ['an unexpected field', { version: 1, plans: {}, extra: true }],
  ])('refuses a malformed remediation-closure verdict record with %s', async (_description, remediationClosure) => {
    const projectRoot = await createProjectRoot();
    await writeFile(join(projectRoot, '.pipeline', 'engine-state.json'), JSON.stringify({ remediationClosure }));

    await expect(readRemediationClosureState(projectRoot)).resolves.toEqual({
      kind: 'incompatible',
      message: 'Engine state contains a malformed remediation-closure verdict record',
    });
  });

  it('writes verdicts additively and applies a reopen exactly once', async () => {
    const projectRoot = await createProjectRoot();
    const statePath = join(projectRoot, '.pipeline', 'engine-state.json');
    const repairObligations = { version: 1, records: { preserved: { state: true } } };
    const unrelated = { preserved: ['byte-identical'] };
    await writeFile(statePath, `${JSON.stringify({ repairObligations, unrelated }, null, 2)}\n`);
    const before = JSON.parse(await readFile(statePath, 'utf8')) as { repairObligations: unknown; unrelated: unknown };

    await recordRemediationClosureVerdicts(projectRoot, '.docs/plans/current.md', [{
      taskId: 'rem-as-built-R11',
      closeIdentity: 'close-1',
      verdict: 'persists',
      rationale: 'The requested repair is absent.',
      disposition: 'reopened',
    }]);
    await markRemediationClosureApplied(projectRoot, '.docs/plans/current.md', 'rem-as-built-R11', 'close-1');
    await markRemediationClosureApplied(projectRoot, '.docs/plans/current.md', 'rem-as-built-R11', 'close-1');

    await expect(readRemediationClosureState(projectRoot)).resolves.toEqual({
      kind: 'present',
      state: {
        version: 1,
        plans: {
          '.docs/plans/current.md': {
            tasks: {
              'rem-as-built-R11': {
                reopenCount: 1,
                verdicts: {
                  'close-1': {
                    verdict: 'persists',
                    rationale: 'The requested repair is absent.',
                    disposition: 'reopened',
                    applied: true,
                  },
                },
              },
            },
          },
        },
      },
    });
    const after = JSON.parse(await readFile(statePath, 'utf8')) as { repairObligations: unknown; unrelated: unknown };
    expect(after.repairObligations).toEqual(before.repairObligations);
    expect(after.unrelated).toEqual(before.unrelated);
  });
});
