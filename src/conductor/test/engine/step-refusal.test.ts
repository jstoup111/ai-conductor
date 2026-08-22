import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  protectedArtifactRefusalResult,
  type StepRunResult,
} from '../../src/engine/conductor.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/events.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('step refusal event spine', () => {
  it('returns the protected-artifact refusal result used by the seal dispatch seam', () => {
    const dispatchIssue = 'Protected artifact changed: .docs/plans/feature.md';

    expect(protectedArtifactRefusalResult(dispatchIssue)).toEqual({
      success: false,
      output: dispatchIssue,
      refused: { kind: 'protected-artifact', reason: dispatchIssue },
    });
  });

  it('persists a typed step refusal through events.jsonl', async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), 'step-refusal-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(projectRoot, '.pipeline', 'events.jsonl'), events);
    const result = {
      success: false,
      refused: { kind: 'protected-artifact', reason: 'x' },
    } satisfies StepRunResult;
    const event = {
      type: 'step_refused',
      step: 'build',
      kind: result.refused.kind,
      reason: result.refused.reason,
    } satisfies ConductorEvent;

    persister.start();
    try {
      await events.emit(event);

      const [line] = (await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n');
      expect(JSON.parse(line)).toMatchObject(event);
    } finally {
      persister.stop();
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
