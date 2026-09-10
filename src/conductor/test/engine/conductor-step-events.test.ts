// Covers: task:2
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../test-conductor.js';
import type { ConductorEvent } from '../../src/types/events.js';

describe('Conductor step close events', () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it('emits the resolved effort and complexity tier when a step completes', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR!, 'conductor-step-events-'));
    directories.push(projectRoot);
    const stateFilePath = join(projectRoot, 'conduct-state.json');
    await writeFile(stateFilePath, JSON.stringify({ complexity_tier: 'M' }));

    const events = new ConductorEventEmitter();
    const completed: ConductorEvent[] = [];
    events.on('step_completed', (event) => completed.push(event));
    const conductor = new Conductor({
      projectRoot,
      stateFilePath,
      events,
      fromStep: 'explore',
      stepRunner: {
        run: async () => ({ success: true, effort: 'high' }),
      },
    });

    await conductor.run();

    expect(completed.find((event) => event.type === 'step_completed' && event.step === 'explore')).toMatchObject({
      effort: 'high',
      tier: 'M',
    });
  });
});
