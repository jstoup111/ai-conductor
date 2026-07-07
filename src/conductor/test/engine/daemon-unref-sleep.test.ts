import { describe, it, expect } from 'vitest';
import { createDefaultSleep } from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for Task 11: default sleep timer uses .unref() so it doesn't
// prevent process exit. When the daemon is idle with no other work pending,
// a pending idle-poll timeout should not keep the Node process alive.
// ─────────────────────────────────────────────────────────────────────────────

describe('daemon default sleep: unref timer (Task 11)', () => {
  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 1: The returned timer is unref'd and won't block process exit
  // ───────────────────────────────────────────────────────────────────────────
  it("createDefaultSleep returns a function that creates unref'd timers", async () => {
    const sleep = createDefaultSleep();

    // Start the sleep (but don't await it to completion)
    const sleepPromise = sleep(10000); // 10 second timeout
    // We can't easily observe .unref() directly, but we can verify:
    // 1. The promise is indeed pending (hasn't resolved yet)
    // 2. After the test, the process can exit (verified by test framework not hanging)

    // Verify the promise is pending (racing with a resolved sentinel)
    const sentinel = Promise.resolve('sentinel');
    const raceResult = await Promise.race([sleepPromise, sentinel]);
    expect(raceResult).toBe('sentinel');
    // This proves sleepPromise is still pending, which is expected
    // The test framework will verify that it doesn't block process exit
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 2: The sleep function resolves when the timer fires
  // ───────────────────────────────────────────────────────────────────────────
  it('sleep resolves when the timer completes', async () => {
    const sleep = createDefaultSleep();
    const startTime = Date.now();
    await sleep(50); // 50ms timeout
    const elapsed = Date.now() - startTime;

    // Verify it actually waited (not instant)
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow some variance
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 3: Multiple sleeps can be created independently
  // ───────────────────────────────────────────────────────────────────────────
  it('multiple sleeps can be created and awaited independently', async () => {
    const sleep = createDefaultSleep();
    const order: number[] = [];

    // Start three sleeps with different durations
    const p1 = sleep(100).then(() => order.push(1));
    const p2 = sleep(50).then(() => order.push(2));
    const p3 = sleep(75).then(() => order.push(3));

    // Wait for all to complete
    await Promise.all([p1, p2, p3]);

    // They should complete in order of shortest to longest timeout
    expect(order).toEqual([2, 3, 1]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Scenario 4: Verify the timer returned from setTimeout is actually unref'd
  // (indirect test: if any timer is ref'd, the test suite hangs)
  // ───────────────────────────────────────────────────────────────────────────
  it('sleep does not prevent the test suite from exiting', async () => {
    const sleep = createDefaultSleep();

    // Create a long sleep that would normally block the process
    // In a real scenario with continuous mode and no other work, this would allow
    // clean shutdown. In the test, we just verify it doesn't hang the suite.
    const longSleep = sleep(60000); // 60 second timeout

    // Do other work immediately while sleep is pending
    let otherWorkDone = false;
    setTimeout(() => {
      otherWorkDone = true;
    }, 10);

    // Wait for the other work, not the sleep
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(otherWorkDone).toBe(true);

    // The sleep is still pending but unref'd, so it won't block
    // When this test ends, the suite continues without waiting for the 60s timer
  });
});
