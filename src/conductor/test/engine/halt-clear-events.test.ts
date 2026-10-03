import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditTrailWriter, type AuditRecord } from '../../src/engine/audit-trail.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('halt-clear event spine', () => {
  it('persists halt-clear authorization with its operator attribution intact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'halt-clear-events-'));
    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(root, '.pipeline', 'events.jsonl'), events);
    const event = {
      type: 'halt_clear_authorized',
      feature: 'halted-feature',
      operator: 'operator@example.test',
      rationale: 'plan amended and resealed',
      haltClass: 'needs-human',
      step: 'build',
    } satisfies ConductorEvent;

    try {
      persister.start();
      await events.emit(event);
      persister.stop();

      const { ts: _ts, ...persisted } = JSON.parse(
        (await readFile(join(root, '.pipeline', 'events.jsonl'), 'utf8')).trim(),
      );
      expect(persisted).toEqual(event);
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes operator authorization and stall-remediation clears to the audit trail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'halt-clear-events-'));
    const events = new ConductorEventEmitter();
    const writer = new AuditTrailWriter(root);

    try {
      writer.subscribe(events);
      await events.emit({
        type: 'halt_clear_authorized',
        feature: 'halted-feature',
        operator: 'operator@example.test',
        rationale: 'plan amended and resealed',
        haltClass: 'needs-human',
        step: 'build',
      } satisfies ConductorEvent);
      await events.emit({ type: 'halt_cleared', step: 'build', cause: 'stall-remediation' } satisfies ConductorEvent);

      const records = (await readFile(join(root, '.pipeline', 'audit-trail', 'events.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as AuditRecord);
      expect(records).toMatchObject([
        { origin: 'operator', event: 'halt_clear_authorized' },
        { origin: 'build', event: 'halt_cleared', cause: 'stall-remediation' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
