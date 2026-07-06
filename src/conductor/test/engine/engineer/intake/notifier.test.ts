// notifier.test.ts — Task 9: status surface write (happy path).
// RED until intake/notifier.ts exists.

import { describe, it, expect, vi } from 'vitest';
import type { Envelope } from '../../../../src/engine/engineer/intake/port.js';

async function loadNotifier() {
  return import('../../../../src/engine/engineer/intake/notifier.js') as Promise<any>;
}

function envelope(sourceRef: string): Envelope {
  return {
    id: sourceRef,
    source: 'github-issues',
    sourceRef,
    text: `idea ${sourceRef}`,
    status: 'pending',
    receivedAt: '2026-07-06T00:00:00.000Z',
  };
}

describe('createNotifier — status surface write (happy)', () => {
  it('notify([2 ideas]) calls writeStatus with count, sourceRefs, and timestamp', async () => {
    const { createNotifier } = await loadNotifier();

    const writeStatus = vi.fn();
    const push = vi.fn();
    const now = vi.fn(() => '2026-07-06T12:00:00.000Z');
    const log = vi.fn();

    const notifier = createNotifier({ writeStatus, push, now, log });

    const ideaA = envelope('owner/X#7');
    const ideaB = envelope('owner/Y#3');

    await notifier.notify([ideaA, ideaB]);

    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(writeStatus).toHaveBeenCalledWith({
      count: 2,
      sourceRefs: ['owner/X#7', 'owner/Y#3'],
      timestamp: '2026-07-06T12:00:00.000Z',
      message: expect.any(String),
    });
  });
});

describe('createNotifier — best-effort push (Task 10)', () => {
  it('notify([2 ideas]) calls deps.push() exactly once with a summary', async () => {
    const { createNotifier } = await loadNotifier();

    const writeStatus = vi.fn();
    const push = vi.fn();
    const now = vi.fn(() => '2026-07-06T12:00:00.000Z');
    const log = vi.fn();

    const notifier = createNotifier({ writeStatus, push, now, log });

    const ideaA = envelope('owner/X#7');
    const ideaB = envelope('owner/Y#3');

    await notifier.notify([ideaA, ideaB]);

    expect(push).toHaveBeenCalledTimes(1);
    const pushArg = push.mock.calls[0][0];
    expect(pushArg.count).toBe(2);
    expect(pushArg.sourceRefs).toEqual(['owner/X#7', 'owner/Y#3']);
    expect(typeof pushArg.message).toBe('string');
    expect(pushArg.message.length).toBeGreaterThan(0);
  });
});

describe('createNotifier — push failure is non-fatal (Task 12)', () => {
  it('notify([1 idea]) persists status and swallows a push() error', async () => {
    const { createNotifier } = await loadNotifier();

    const writeStatus = vi.fn();
    const push = vi.fn(() => {
      throw new Error('push transport unavailable');
    });
    const now = vi.fn(() => '2026-07-06T12:00:00.000Z');
    const log = vi.fn();

    const notifier = createNotifier({ writeStatus, push, now, log });

    const idea = envelope('owner/Z#1');

    await expect(notifier.notify([idea])).resolves.toBeUndefined();

    expect(writeStatus).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledTimes(1);
    expect(
      log.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].toLowerCase().includes('push'),
      ),
    ).toBe(true);
  });
});

describe('createNotifier — empty capture (Task 11)', () => {
  it('notify([]) resolves cleanly without calling writeStatus or push', async () => {
    const { createNotifier } = await loadNotifier();

    const writeStatus = vi.fn();
    const push = vi.fn();
    const now = vi.fn(() => '2026-07-06T12:00:00.000Z');
    const log = vi.fn();

    const notifier = createNotifier({ writeStatus, push, now, log });

    await expect(notifier.notify([])).resolves.toBeUndefined();

    expect(writeStatus).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
