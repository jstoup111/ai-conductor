// Covers: task:1, task:2, task:3
import { describe, expect, it } from 'vitest';

import { createOrderingSource } from '../../src/engine/ordering-source.js';
import type { IntakeEventEmitter } from '../../src/engine/intake-backend-composite.js';
import type { GhRunner } from '../../src/engine/tracker-client.js';

describe('Task 1 — GitHub ordering facts', () => {
  it('reads priority and size facts through the canonical GitHub runner', async () => {
    const argv: string[][] = [];
    const run: GhRunner = async (args) => {
      argv.push(args);
      return { stdout: JSON.stringify({ labels: [{ name: 'priority: high' }, { name: 'size: M' }] }) };
    };

    const source = createOrderingSource({ run });
    const facts = await source.readFacts(['acme/app#12']);

    expect({ facts: facts.get('acme/app#12'), argv }).toEqual({
      facts: { priority: 'high', size: 'M' },
      argv: [['api', 'repos/acme/app/issues/12']],
    });
  });

  it('uses the existing parsers when several valid priority and size labels exist', async () => {
    const run: GhRunner = async () => ({
      stdout: JSON.stringify({
        labels: [
          { name: 'priority: low' },
          { name: 'priority: critical' },
          { name: 'size: S' },
          { name: 'size: L' },
        ],
      }),
    });

    const facts = await createOrderingSource({ run }).readFacts(['acme/app#13']);

    expect(facts.get('acme/app#13')).toEqual({ priority: 'critical', size: 'L' });
  });

  it('preserves the parsers exact, case-sensitive label grammar', async () => {
    const run: GhRunner = async () => ({
      stdout: JSON.stringify({
        labels: [
          { name: 'Priority: High' },
          { name: 'priority:high' },
          { name: 'size: XL' },
          { name: 'Size: M' },
        ],
      }),
    });

    const facts = await createOrderingSource({ run }).readFacts(['acme/app#14']);

    expect(facts.get('acme/app#14')).toEqual({ priority: undefined, size: undefined });
  });

  it('maps status 404 failures to not-found', async () => {
    const notFound = Object.assign(new Error('missing'), { status: 404 });
    const run: GhRunner = async () => Promise.reject(notFound);

    const facts = await createOrderingSource({ run }).readFacts(['acme/app#15']);

    expect(facts.get('acme/app#15')).toBe('not-found');
  });

  it('does not invoke the runner for an unparseable ref', async () => {
    let calls = 0;
    const run: GhRunner = async () => {
      calls += 1;
      return { stdout: '{}' };
    };

    const facts = await createOrderingSource({ run }).readFacts(['not-a-ref']);

    expect({ outcome: facts.get('not-a-ref'), calls }).toEqual({ outcome: 'not-found', calls: 0 });
  });

  it('rethrows a non-404 runner failure unchanged', async () => {
    const outage = new Error('tracker unavailable');
    const run: GhRunner = async () => Promise.reject(outage);

    const read = createOrderingSource({ run }).readFacts(['acme/app#16']);

    await expect(read).rejects.toBe(outage);
  });
});

describe('Task 2 — GitHub ordering blockers', () => {
  it('reads open blockers through the canonical GitHub runner', async () => {
    const argv: string[][] = [];
    const run: GhRunner = async (args) => {
      argv.push(args);
      return {
        stdout: JSON.stringify([
          {
            number: 7,
            repository_url: 'https://api.github.com/repos/acme/app',
            state: 'open',
          },
        ]),
      };
    };

    const blockers = await createOrderingSource({ run }).readBlockers('acme/app#12');

    expect({ blockers, argv }).toEqual({
      blockers: ['acme/app#7'],
      argv: [['api', 'repos/acme/app/issues/12/dependencies/blocked_by']],
    });
  });

  it('returns no blockers for empty or entirely closed responses', async () => {
    const run: GhRunner = async (args) => ({
      stdout: args[1]?.includes('/issues/12/')
        ? '[]'
        : JSON.stringify([
          { number: 7, repository_url: 'https://api.github.com/repos/acme/app', state: 'closed', state_reason: 'completed' },
          { number: 8, repository_url: 'https://api.github.com/repos/acme/app', state: 'closed', state_reason: 'not_planned' },
        ]),
    });
    const source = createOrderingSource({ run });

    const outcomes = await Promise.all([
      source.readBlockers('acme/app#12'),
      source.readBlockers('acme/app#13'),
    ]);

    expect(outcomes).toEqual([[], []]);
  });

  it('returns runner failures as indeterminate details', async () => {
    const run: GhRunner = async () => Promise.reject(new Error('boom'));

    const blockers = await createOrderingSource({ run }).readBlockers('acme/app#12');

    expect(blockers).toEqual({ indeterminate: 'boom' });
  });

  it('returns malformed blocker bodies as indeterminate details', async () => {
    const run: GhRunner = async () => ({ stdout: 'not-json' });

    const blockers = await createOrderingSource({ run }).readBlockers('acme/app#12');

    expect(blockers).toEqual({
      indeterminate: expect.stringMatching(/^unparseable blocked_by response:/),
    });
  });

  it('does not invoke the runner for an unparseable blocker ref', async () => {
    let calls = 0;
    const run: GhRunner = async () => {
      calls += 1;
      return { stdout: '[]' };
    };

    const blockers = await createOrderingSource({ run }).readBlockers('not-a-ref');

    expect({ blockers, calls }).toEqual({
      blockers: { indeterminate: 'unparseable sourceRef: not-a-ref' },
      calls: 0,
    });
  });
});

describe('Task 3 — Jira ordering facts and blockers', () => {
  it('returns unavailable without a runner call and emits the exact event once across facts, blockers, and repeats', async () => {
    let calls = 0;
    const run: GhRunner = async () => {
      calls += 1;
      throw new Error('Jira references must not reach the GitHub runner');
    };
    const emitted: Array<Extract<Parameters<IntakeEventEmitter['emit']>[0], { type: 'tracker_backend_unavailable' }>> = [];
    const events: IntakeEventEmitter = {
      async emit(event) {
        if (event.type === 'tracker_backend_unavailable') emitted.push(event);
      },
    };
    const source = createOrderingSource({ run, events });

    const outcomes = await Promise.all([
      source.readFacts(['PROJ-123']),
      source.readBlockers('PROJ-123'),
      source.readFacts(['PROJ-123']),
      source.readBlockers('PROJ-123'),
    ]);

    expect(outcomes).toEqual([
      new Map([['PROJ-123', 'unavailable']]),
      'unavailable',
      new Map([['PROJ-123', 'unavailable']]),
      'unavailable',
    ]);
    expect(calls).toBe(0);
    expect(emitted).toEqual([
      { type: 'tracker_backend_unavailable', project: 'PROJ-123', backend: 'jira', reason: 'no-adapter' },
    ]);
  });

  it('deduplicates events by Jira key and works without an event emitter', async () => {
    const run: GhRunner = async () => {
      throw new Error('Jira references must not reach the GitHub runner');
    };
    const emitted: Array<Extract<Parameters<IntakeEventEmitter['emit']>[0], { type: 'tracker_backend_unavailable' }>> = [];
    const source = createOrderingSource({
      run,
      events: {
        async emit(event) {
          if (event.type === 'tracker_backend_unavailable') emitted.push(event);
        },
      },
    });

    expect(await source.readFacts(['PROJ-1', 'PROJ-2'])).toEqual(new Map([
      ['PROJ-1', 'unavailable'],
      ['PROJ-2', 'unavailable'],
    ]));
    expect(emitted).toEqual([
      { type: 'tracker_backend_unavailable', project: 'PROJ-1', backend: 'jira', reason: 'no-adapter' },
      { type: 'tracker_backend_unavailable', project: 'PROJ-2', backend: 'jira', reason: 'no-adapter' },
    ]);

    const withoutEvents = createOrderingSource({ run });
    await expect(withoutEvents.readFacts(['PROJ-123'])).resolves.toEqual(new Map([['PROJ-123', 'unavailable']]));
    await expect(withoutEvents.readBlockers('PROJ-123')).resolves.toBe('unavailable');
  });
});
