// engineer-cli.ts composition root must route gh construction through the canonical
// TrackerClient seam (tracker-client.ts) so the AI_CONDUCTOR_NO_REAL_EXEC kill switch
// applies uniformly (Task 10). Prior to this, engineer-cli.ts had its own local
// `makeProductionGh` that did not call `assertRealExecAllowed`, so a CLI dispatch with
// no injected `gh` could still spawn a real `gh` process even under the kill switch.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { makeProductionGh } from '../../../src/engine/engineer-cli.js';
import { makeProductionGh as canonicalMakeProductionGh } from '../../../src/engine/tracker-client.js';

describe('engineer-cli composition root — canonical TrackerClient seam', () => {
  let prevKillSwitch: string | undefined;

  beforeEach(() => {
    prevKillSwitch = process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    process.env.AI_CONDUCTOR_NO_REAL_EXEC = '1';
  });

  afterEach(() => {
    if (prevKillSwitch === undefined) delete process.env.AI_CONDUCTOR_NO_REAL_EXEC;
    else process.env.AI_CONDUCTOR_NO_REAL_EXEC = prevKillSwitch;
  });

  it('re-exports the canonical tracker-client makeProductionGh (no local duplicate that bypasses the kill switch)', () => {
    expect(makeProductionGh).toBe(canonicalMakeProductionGh);
  });

  it('the exported gh runner is blocked by AI_CONDUCTOR_NO_REAL_EXEC instead of spawning real gh', async () => {
    const gh = makeProductionGh();
    await expect(gh(['issue', 'list'], { cwd: process.cwd() })).rejects.toThrow(
      /AI_CONDUCTOR_NO_REAL_EXEC|real .*(gh|exec).* blocked/i,
    );
  });
});
