import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState, StepName } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// Acceptance coverage for .docs/stories/ship-tail-parallel-validation-serial-
// publication-922.md. This drives Conductor.run() through explicit finish
// targeting: the #532 resume clamp is intentionally bypassed, but publication
// safety must not be.
describe('SHIP-tail publication fence (#922)', () => {
  it('does not dispatch finish when explicit targeting reaches an already-done rebase with failed or stale validation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ship-tail-fence-'));
    const statePath = join(dir, '.pipeline', 'conduct-state.json');
    try {
      await mkdir(join(dir, '.pipeline'), { recursive: true });
      await writeState(statePath, {
        complexity_tier: 'M',
        track: 'product',
        architecture_review: 'done',
        manual_test: 'done',
        prd_audit: 'failed',
        architecture_review_as_built: 'stale',
        retro: 'skipped',
        rebase: 'done',
      } as ConductState);

      const run = vi.fn(async (_step: StepName) => ({ success: true }));
      const runner: StepRunner = { run };
      const conductor = new Conductor({
        projectRoot: dir,
        stateFilePath: statePath,
        stepRunner: runner,
        events: new ConductorEventEmitter(),
        daemon: true,
        mode: 'auto',
        fromStep: 'finish',
        maxRetries: 1,
      });

      await conductor.run();

      expect(run.mock.calls.map(([step]) => step)).not.toContain('finish');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
