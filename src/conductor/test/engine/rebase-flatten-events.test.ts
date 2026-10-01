// Covers: task:10
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { EventPersister } from '../../src/engine/event-persister.js';
import { emitRebaseEvent, type RebaseOutcome } from '../../src/engine/rebase.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const flattened = {
  entries: [],
  audit: { flattenedMerges: ['merge-one', 'merge-two'], ancestryOnlyMerges: ['ancestry-only'], sideLineageCount: 3 },
  pairs: [],
  absorptionPoints: [],
};

describe('emitRebaseEvent flattened replay audit (Task 10)', () => {
  it('emits and persists exactly one merge audit for a flattened changed replay', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rebase-flatten-events-'));
    const events = new ConductorEventEmitter();
    const persisted = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    const observed: unknown[] = [];
    events.on('rebase_merge_audit', event => { observed.push(event); });
    try {
      persisted.start();
      const outcome: RebaseOutcome = { kind: 'changed', changedCodePaths: ['src/a.ts'], flatten: flattened };
      await emitRebaseEvent(events, outcome);
      persisted.stop();
      expect(observed).toEqual([{ type: 'rebase_merge_audit', ...flattened.audit }]);
      const records = (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      expect(records.filter((record: { type: string }) => record.type === 'rebase_merge_audit')).toEqual([
        { type: 'rebase_merge_audit', ...flattened.audit, ts: expect.any(String) },
      ]);
    } finally {
      persisted.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each<RebaseOutcome>([
    { kind: 'noop' },
    { kind: 'mergeable_skip', baseRef: 'main', baseSha: 'base', baseKind: 'local' },
    { kind: 'changed', changedCodePaths: [] },
  ])('does not emit an audit for non-flattened $kind outcomes', async outcome => {
    const events = new ConductorEventEmitter();
    const observed: unknown[] = [];
    events.on('rebase_merge_audit', event => { observed.push(event); });
    await emitRebaseEvent(events, outcome);
    expect(observed).toEqual([]);
  });
});
