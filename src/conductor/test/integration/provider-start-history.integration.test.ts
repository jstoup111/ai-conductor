import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { computeCostRollup } from '../../src/engine/cost-rollup.js';
import { startFeatureEventPersistence } from '../../src/engine/event-persister.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('provider start history', () => {
  it('persists begun attempts in order without changing cost accounting', async () => {
    const root = await mkdtemp(join(tmpdir(), 'provider-start-history-'));
    const events = new ConductorEventEmitter();
    const persistence = startFeatureEventPersistence(root, events, 'history');
    try {
      await persistence.events.emit({ type: 'provider_attempt_started', step: 'build', provider: { kind: 'known', id: 'claude' } });
      await persistence.events.emit({ type: 'provider_attempt_started', step: 'build', provider: { kind: 'known', id: 'codex' }, executionContext: {
        executionId: 'review-security', subject: { kind: 'configured-member', parentGroup: 'review', member: 'security' },
      } });
      const records = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
      expect(records.map((record) => record.provider.id)).toEqual(['claude', 'codex']);
      expect(records.every((record) => typeof record.ts === 'string')).toBe(true);
      expect(records[1].executionContext.subject.member).toBe('security');
      expect(await computeCostRollup(root)).toMatchObject({ dispatches: 0, costUsd: 0 });
    } finally {
      persistence.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
