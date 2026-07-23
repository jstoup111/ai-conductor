// outcome-staging.test.ts — Task 1 (Story 1 happy path): staging the intake's
// Desired-outcome bullets into the worktree's gitignored .pipeline/ BEFORE any
// DECIDE artifact is authored.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stageIntakeOutcomes } from '../../../src/engine/engineer/outcome-staging.js';

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
});
