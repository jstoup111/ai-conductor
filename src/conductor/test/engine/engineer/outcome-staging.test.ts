// outcome-staging.test.ts — Task 1 (Story 1 happy path): staging the intake's
// Desired-outcome bullets into the worktree's gitignored .pipeline/ BEFORE any
// DECIDE artifact is authored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, access, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  stageIntakeOutcomes,
  readStagedIntakeOutcomes,
  readCommittedIntakeOutcomes,
  INTAKE_OUTCOMES_RELATIVE_PATH,
} from '../../../src/engine/engineer/outcome-staging.js';

describe('stageIntakeOutcomes', () => {
  let worktreePath: string;

  beforeEach(async () => {
    worktreePath = await mkdtemp(join(tmpdir(), 'engineer-outcome-staging-'));
  });

  afterEach(async () => {
    await rm(worktreePath, { recursive: true, force: true });
  });

  it('writes .pipeline/intake-outcomes.md carrying Source-Ref and the verbatim Desired-outcome bullet block', async () => {
    const sourceRef = 'owner/repo#42';
    const intakeBody =
      '## What\n\nSome observed evidence.\n\n' +
      '## Desired outcome\n\n' +
      '- Bullet one\n' +
      '- Bullet two\n';

    const stagedPath = await stageIntakeOutcomes(worktreePath, sourceRef, intakeBody);

    expect(stagedPath).toBe(join(worktreePath, '.pipeline', 'intake-outcomes.md'));
    const contents = await readFile(stagedPath!, 'utf8');
    expect(contents).toContain(`Source-Ref: ${sourceRef}`);
    expect(contents).toContain('## Desired outcome\n\n- Bullet one\n- Bullet two');
  });

  it('no-ops (no file, no throw) when there is no sourceRef and no intakeBody (chat/CLI origin)', async () => {
    await expect(stageIntakeOutcomes(worktreePath, undefined, undefined)).resolves.toBeNull();
    await expect(stageIntakeOutcomes(worktreePath, null, null)).resolves.toBeNull();
    await expect(stageIntakeOutcomes(worktreePath, 'owner/repo#1', undefined)).resolves.toBeNull();
    await expect(stageIntakeOutcomes(worktreePath, undefined, '## Desired outcome\n\n- x\n')).resolves.toBeNull();

    await expect(access(join(worktreePath, INTAKE_OUTCOMES_RELATIVE_PATH))).rejects.toThrow();
  });

  it('stages zero bullets when the Desired-outcome section is empty, and the reader reports outcome layer not required', async () => {
    const sourceRef = 'owner/repo#7';
    const intakeBody = '## What\n\nSome evidence.\n\n## Desired outcome\n\n## Next\n\nother stuff\n';

    const stagedPath = await stageIntakeOutcomes(worktreePath, sourceRef, intakeBody);
    expect(stagedPath).toBe(join(worktreePath, '.pipeline', 'intake-outcomes.md'));

    const contents = await readFile(stagedPath!, 'utf8');
    expect(contents).toContain(`Source-Ref: ${sourceRef}`);
    expect(contents).toContain('## Desired outcome');

    const result = await readStagedIntakeOutcomes(worktreePath);
    expect(result).toEqual({ required: false, bullets: [], sourceRef });
  });

  it('reports outcome layer not required when nothing was staged at all', async () => {
    const result = await readStagedIntakeOutcomes(worktreePath);
    expect(result).toEqual({ required: false, bullets: [], sourceRef: null });
  });

  it('reports outcome layer required when bullets are present', async () => {
    await stageIntakeOutcomes(
      worktreePath,
      'owner/repo#9',
      '## Desired outcome\n\n- Bullet A\n- Bullet B\n',
    );

    const result = await readStagedIntakeOutcomes(worktreePath);
    expect(result.required).toBe(true);
    expect(result.bullets).toEqual(['- Bullet A', '- Bullet B']);
  });

  it('leaves the staged outcomes file in place after a simulated failed land (no deletion in this module)', async () => {
    const sourceRef = 'owner/repo#42';
    const intakeBody = '## Desired outcome\n\n- Keep me\n';
    const stagedPath = await stageIntakeOutcomes(worktreePath, sourceRef, intakeBody);

    // Simulate a failed land step that throws after staging has occurred.
    const simulateFailedLand = async () => {
      throw new Error('land failed before commit');
    };
    await expect(simulateFailedLand()).rejects.toThrow('land failed before commit');

    // The staged file must still be present — this module never deletes it.
    const contents = await readFile(stagedPath!, 'utf8');
    expect(contents).toContain('Keep me');
  });
});

describe('readCommittedIntakeOutcomes', () => {
  let worktreePath: string;

  beforeEach(async () => {
    worktreePath = await mkdtemp(join(tmpdir(), 'engineer-outcome-staging-'));
  });

  afterEach(async () => {
    await rm(worktreePath, { recursive: true, force: true });
  });

  async function writeMarker(planStem: string, contents: string): Promise<void> {
    const intakeDir = join(worktreePath, '.docs', 'intake');
    await mkdir(intakeDir, { recursive: true });
    await writeFile(join(intakeDir, `${planStem}.md`), contents, 'utf8');
  }

  it('reads Source-Ref and Desired-outcome bullets from the committed .docs/intake/<planStem>.md marker', async () => {
    await writeMarker(
      'my-plan-stem',
      '# Intake origin: my-plan-stem\n\n' +
        'Source-Ref: owner/repo#42\n\n' +
        '## Desired outcome\n\n' +
        '- Bullet one\n' +
        '- Bullet two\n',
    );

    const result = await readCommittedIntakeOutcomes(worktreePath, 'my-plan-stem');
    expect(result).toEqual({
      required: true,
      bullets: ['- Bullet one', '- Bullet two'],
      sourceRef: 'owner/repo#42',
    });
  });

  it('reports outcome layer not required when the marker exists but has no Desired-outcome bullets', async () => {
    await writeMarker(
      'my-plan-stem',
      '# Intake origin: my-plan-stem\n\nSource-Ref: owner/repo#7\n',
    );

    const result = await readCommittedIntakeOutcomes(worktreePath, 'my-plan-stem');
    expect(result).toEqual({ required: false, bullets: [], sourceRef: 'owner/repo#7' });
  });

  it('reports outcome layer not required when no marker file exists', async () => {
    const result = await readCommittedIntakeOutcomes(worktreePath, 'no-such-stem');
    expect(result).toEqual({ required: false, bullets: [], sourceRef: null });
  });
});
