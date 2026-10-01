// Covers: task:18
import { readFile } from 'node:fs/promises';

import { describe, expect, it, vi } from 'vitest';

import { EVENT_SINKS } from '../../../src/engine/event-sinks.js';
import type { ProjectHalt } from '../../../src/engine/monitor/halt-inventory.js';
import { runGuidedMonitorQueue } from '../../../src/engine/monitor/loop.js';
import type { ConductorEvent } from '../../../src/types/events.js';

type MonitorQueueTransition = Extract<ConductorEvent, {
  type:
    | 'monitor_item_offered'
    | 'monitor_session_opened'
    | 'monitor_item_deferred'
    | 'monitor_session_ended';
}>;

function halt(): ProjectHalt {
  return {
    project: '/projects/alpha',
    projectName: 'alpha',
    slug: 'guided-recovery',
    reason: 'guided-recovery needs recovery',
    haltClass: 'needs-human',
  };
}

describe('Task 18 — monitor queue event spine', () => {
  it('emits distinct offered, opened, deferred, and ended transitions through the recording emitter', async () => {
    const item = halt();
    const events: MonitorQueueTransition[] = [];
    const emit = vi.fn(async (event: ConductorEvent) => {
      events.push(event as MonitorQueueTransition);
    });
    let membership: readonly ProjectHalt[] = [item];

    await runGuidedMonitorQueue({
      deriveMembership: async () => membership,
      offer: vi.fn(),
      launch: async () => {
        membership = [];
      },
      readOperatorInput: async () => {
        return 'skip';
      },
      snapshotHaltMarker: async () => ({ present: true, mtimeMs: 12, size: 34 }),
      recordDeferral: async () => {},
      events: { emit },
    });

    expect(events).toEqual([
      { type: 'monitor_item_offered', project: item.project, feature: item.slug },
      { type: 'monitor_session_opened', project: item.project, feature: item.slug },
      { type: 'monitor_item_deferred', project: item.project, feature: item.slug },
      { type: 'monitor_session_ended', project: item.project, feature: item.slug },
    ]);
  });

  it('declares an explicit, durable sink for every monitor transition', () => {
    expect({
      offered: EVENT_SINKS.monitor_item_offered,
      opened: EVENT_SINKS.monitor_session_opened,
      deferred: EVENT_SINKS.monitor_item_deferred,
      ended: EVENT_SINKS.monitor_session_ended,
    }).toEqual({
      offered: { render: false, persist: true, audit: false, otel: false },
      opened: { render: false, persist: true, audit: false, otel: false },
      deferred: { render: false, persist: true, audit: false, otel: false },
      ended: { render: false, persist: true, audit: false, otel: false },
    });
  });

  it('keeps transition reporting on the injected event emitter, with no bespoke event write', async () => {
    const source = await readFile(new URL('../../../src/engine/monitor/loop.ts', import.meta.url), 'utf8');

    expect({
      emitsTransitions: /events\?\.emit\(/.test(source),
      writesBespokeEventFormat: /(?:appendFile|writeFile|createWriteStream|EventPersister)\s*\(/.test(source),
    }).toEqual({
      emitsTransitions: true,
      writesBespokeEventFormat: false,
    });
  });
});
