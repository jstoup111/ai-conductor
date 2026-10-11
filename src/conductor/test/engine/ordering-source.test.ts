// Covers: task:1
import { describe, expect, it } from 'vitest';

import { createOrderingSource } from '../../src/engine/ordering-source.js';
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
