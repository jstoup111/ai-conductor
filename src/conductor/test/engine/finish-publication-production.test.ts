import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProductionFinishPublicationCoordinator } from '../../src/engine/finish-publication-production.js';
import type { ConductState } from '../../src/types/index.js';

const commandResult = { stdout: '' };

describe('production FINISH publication composition', () => {
  it.each([
    { mode: 'interactive' as const, daemon: false },
    { mode: 'default' as const, daemon: false },
    { mode: 'auto' as const, daemon: false },
    { mode: 'auto' as const, daemon: true },
  ])('preflights %s without a provider or GitHub call when BUILD evidence is absent', async ({ mode, daemon }) => {
    const root = await mkdtemp(join(tmpdir(), 'finish-production-composition-'));
    try {
      const pipeline = join(root, '.pipeline');
      await mkdir(pipeline);
      // Interactive intent is operator-owned; a valid stored intent lets this
      // bounded test reach the same coordinator preflight as unattended modes.
      await writeFile(join(pipeline, 'finish-choice'), daemon ? 'pr\n' : 'keep\n');
      const git = vi.fn(async () => commandResult);
      const gh = vi.fn(async () => commandResult);
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        git,
        gh,
      });
      const dispatchJudgment = vi.fn(async () => ({ success: true }));

      const disposition = await coordinator.advance({
        state: { feature_desc: 'feature' } as ConductState,
        mode,
        daemon,
        dispatchJudgment,
        emit: async () => {},
      });

      expect(disposition).toMatchObject({ kind: 'publication_retry' });
      expect(dispatchJudgment).not.toHaveBeenCalled();
      // The fake boundaries are the only allowed process/network seam in this
      // integration test; no real provider or GitHub executable is reachable.
      expect(git).toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
