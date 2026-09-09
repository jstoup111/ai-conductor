import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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
  let commandWorktree: string;
  let outsideCommandRoot: string;

  const commandSlug = 'grant-fixture';

  beforeEach(async () => {
    fixture = await createDecideEntryFixture(
      await mkdtemp(join(tmpdir(), 'decide-entry-operator-grant-')),
    );
    commandRoot = await mkdtemp(join(tmpdir(), 'decide-grant-command-'));
    const git = (args: string[], cwd = commandRoot) => execa('git', args, { cwd });
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test User']);
    await git(['config', 'commit.gpgsign', 'false']);
    await writeFile(join(commandRoot, 'README.md'), '# fixture\n', 'utf-8');
    await git(['add', '.']);
    await git(['commit', '-q', '-m', 'initial']);
    commandWorktree = join(commandRoot, '.worktrees', commandSlug);
    await mkdir(dirname(commandWorktree), { recursive: true });
    await git(['worktree', 'add', '-b', `spec/${commandSlug}`, commandWorktree, 'main']);
    outsideCommandRoot = await mkdtemp(join(tmpdir(), 'decide-grant-outside-'));
  });

  afterEach(async () => {
    await cleanupDecideEntryFixture(fixture);
    await rm(commandRoot, { recursive: true, force: true });
    await rm(outsideCommandRoot, { recursive: true, force: true });
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

  it('the real CLI writes the grant into the main checkout store from a linked worktree', async () => {
    const binary = join(process.cwd(), '..', '..', 'bin', 'conduct-ts');

    const result = await execa(
      binary,
      ['decide-grant', '--slug', commandSlug, '--step', 'stories', '--reason', 'approve stories amendment'],
      { cwd: commandWorktree, reject: false },
    );

    expect(result.exitCode).toBe(0);
    const grant = JSON.parse(
      (await readOptional(commandRoot, join('.daemon', 'grants', `${commandSlug}.json`))) ?? '{}',
    ) as Record<string, unknown>;
    expect(grant).toMatchObject({
      version: 1,
      step: 'stories',
      reason: 'approve stories amendment',
      grantedBy: 'operator',
    });
    // Nothing is written into the agent-writable worktree location.
    expect(await readOptional(commandWorktree, '.pipeline/decide-grant.json')).toBeNull();
  }, 30_000);

  it('the real CLI refuses a grant outside any repository without creating a store', async () => {
    const binary = join(process.cwd(), '..', '..', 'bin', 'conduct-ts');

    const result = await execa(
      binary,
      ['decide-grant', '--slug', commandSlug, '--step', 'stories', '--reason', 'outside repository'],
      {
        cwd: outsideCommandRoot,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(outsideCommandRoot) },
        reject: false,
      },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/unresolved repository/i);
    expect(await readOptional(outsideCommandRoot, join('.daemon', 'grants', `${commandSlug}.json`))).toBeNull();
    expect(await pathExists(outsideCommandRoot, '.daemon')).toBe(false);
  }, 30_000);

  it('the real CLI refuses to grant plan at all', async () => {
    const slug = 'grant-fixture-plan';
    const binary = join(process.cwd(), '..', '..', 'bin', 'conduct-ts');

    const result = await execa(
      binary,
      ['decide-grant', '--slug', slug, '--step', 'plan', '--reason', 'approve plan amendment'],
      { cwd: commandWorktree, reject: false },
    );

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/cannot be granted/i);
    expect(
      await readOptional(commandRoot, join('.daemon', 'grants', `${slug}.json`)),
    ).toBeNull();
  }, 30_000);

  it('rejects a traversal slug instead of writing outside a feature worktree', async () => {
    const binary = join(process.cwd(), '..', '..', 'bin', 'conduct-ts');

    const result = await execa(
      binary,
      ['decide-grant', '--slug', '..', '--step', 'plan', '--reason', 'unsafe target'],
      { cwd: commandRoot, reject: false },
    );

    expect(result.exitCode).toBe(1);
  }, 30_000);

  it('constructs grants only in the CLI command module', async () => {
    const sourceRoot = join(process.cwd(), 'src');
    const sourceFiles = await readdir(sourceRoot, { recursive: true });
    const grantWriters = (
      await Promise.all(
        sourceFiles
          .filter((path) => path.endsWith('.ts'))
          .map(async (path) => ({
            path,
            source: await readFile(join(sourceRoot, path), 'utf-8'),
          })),
      )
    )
      .filter(({ source }) => source.includes('decide-grant.json') && source.includes('writeFile('))
      .map(({ path }) => path);

    expect(grantWriters).toEqual(['cli.ts']);
  });

  it('a grant dispatches nothing and is left unconsumed — DECIDE is human-only under the daemon', async () => {
    await writeFixtureState(fixture, resolvedState({ plan: 'pending', coherence_check: 'pending' }));
    await seedGrant('plan');
    const ran: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(ran)).run();

    // No provider work: the grant authorizes nothing, so nothing is consumed either.
    expect(ran).toEqual([]);
    expect(await pathExists(fixture.root, '.pipeline/decide-grant.json')).toBe(true);
    expect(await readOptional(fixture.root, '.pipeline/HALT.class')).toMatch(/needs-human/i);
  });

  it('a consumed plan grant cannot authorize a later plan entry', async () => {
    await writeFixtureState(fixture, resolvedState({ plan: 'pending', coherence_check: 'pending' }));
    await seedGrant('plan');
    await conductorFor(fixture, recordingFailureRunner([])).run();
    await rm(join(fixture.root, '.pipeline/HALT'), { force: true });
    await rm(join(fixture.root, '.pipeline/HALT.class'), { force: true });
    await writeFixtureState(fixture, resolvedState({ plan: 'pending', coherence_check: 'pending' }));
    const rerun: StepName[] = [];

    await conductorFor(fixture, recordingFailureRunner(rerun)).run();

    expect(rerun).toEqual([]);
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
