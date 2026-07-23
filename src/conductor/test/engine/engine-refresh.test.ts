import { describe, it, expect } from "vitest";
import { createRefreshThrottle } from "../../src/engine/engine-refresh.js";

describe("createRefreshThrottle", () => {
  it("allows the first call when it has never run", () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    expect(throttle.shouldRun()).toBe(true);
  });

  it("throttles a second call within the window after markRan()", () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    expect(throttle.shouldRun()).toBe(true);
    throttle.markRan();
    clock += 1000; // still within 5000ms window
    expect(throttle.shouldRun()).toBe(false);
  });

  it("allows another run once the window has expired", () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    throttle.markRan();
    clock += 5001; // window has elapsed
    expect(throttle.shouldRun()).toBe(true);
  });
});
