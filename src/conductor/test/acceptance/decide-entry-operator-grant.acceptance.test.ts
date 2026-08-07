import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StepName } from '../../src/types/index.js';
import {
  cleanupDecideEntryFixture,
  conductorFor,
  createDecideEntryFixture,
  pathExists,
  readOptional,
  recordingFailureRunner,
  resolvedState,
  type DecideEntryFixture,
  writeFixtureState,
} from './decide-entry-fixture.js';

// Story 6. Production entry points: real bin/conduct-ts command, then Conductor.run().
describe('acceptance: explicit operator grants are scoped and single-use', () => {
  let fixture: DecideEntryFixture;
  let commandRoot: string;

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-operator-grant-')),
    );
    commandRoot = await mkdtemp(join(tmpdir(), 'decide-grant-command-'));
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
    await rm(commandRoot, { recursive: true, force: true });
  });

  async function seedGrant(step: StepName): Promise<void> {
    await mkdir(join(fixture.root, '.pipeline'), { recursive: true });
    await writeFile(
      join(fixture.root, '.pipeline/decide-grant.json'),
      JSON.stringify({
        version: 1,
        step,
        reason: 'operator approved one authoring pass',
        grantedAt: '2026-08-07T00:00:00.000Z',
        grantedBy: 'operator',
      }),
      'utf-8',
    );
  }

  it('the real CLI writes the grant into the named feature worktree', async () => {
    const slug = 'grant-fixture';
    await mkdir(join(commandRoot, '.worktrees', slug), { recursive: true });
    const binary = join(process.cwd(), '..', '..', 'bin', 'conduct-ts');

    const result = await execa(
      binary,
      ['decide-grant', '--slug', slug, '--step', 'plan', '--reason', 'approve plan amendment'],
      { cwd: commandRoot, reject: false },
    );

    expect(result.exitCode).toBe(0);
    const grant = JSON.parse(
      (await readOptional(
        join(commandRoot, '.worktrees', slug),
        '.pipeline/decide-grant.json',
      )) ?? '{}',
    ) as Record<string, unknown>;
    expect(grant).toMatchObject({
      version: 1,
      step: 'plan',
      reason: 'approve plan amendment',
      grantedBy: 'operator',
    });
  }, 30_000);

  it('dispatches only the granted step and consumes the grant before provider work starts', async () => {
    await writeFixtureState(fixture, resolvedState({ plan: 'pending', coherence_check: 'pending' }));
    await seedGrant('plan');
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran[0]).toBe('plan');
    expect(await pathExists(fixture.root, '.pipeline/decide-grant.json')).toBe(false);
  });

  it('a grant for plan cannot authorize an earlier missing stories step', async () => {
    await writeFixtureState(
      fixture,
      resolvedState({ stories: 'pending', conflict_check: 'pending', plan: 'pending' }),
    );
    await seedGrant('plan');
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    expect(ran).toEqual([]);
    expect(await pathExists(fixture.root, '.pipeline/decide-grant.json')).toBe(true);
    expect(await readOptional(fixture.root, '.pipeline/HALT')).toMatch(/Requested target:\s*stories/i);
  });

  it('clearing HALT files without a grant re-halts and still launches no provider', async () => {
    await writeFixtureState(fixture, resolvedState({ plan: 'pending', coherence_check: 'pending' }));
    const firstRan: StepName[] = [];
    await conductorFor(fixture, recordingFailureRunner(firstRan)).run();
    await rm(join(fixture.root, '.pipeline/HALT'), { force: true });
    await rm(join(fixture.root, '.pipeline/HALT.class'), { force: true });

    const secondRan: StepName[] = [];
    await conductorFor(fixture, recordingFailureRunner(secondRan)).run();

    expect(firstRan).toEqual([]);
    expect(secondRan).toEqual([]);
    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toBe('needs-human');
    expect(await readOptional(fixture.root, '.pipeline/HALT')).toMatch(/Requested target:\s*plan/i);
  });
});
