import { describe, it, expect } from "vitest";
import {
  createRefreshThrottle,
  createStalenessWarner,
} from "../../src/engine/engine-refresh.js";

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

describe("createStalenessWarner", () => {
  it("emits a warning containing the cause and all three reload commands", () => {
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    warner.warn("origin-advanced", "sha123", "main");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("origin-advanced");
    expect(lines[0]).toContain("git pull --ff-only origin main");
    expect(lines[0]).toContain("npm run build");
    expect(lines[0]).toContain("conduct daemon restart");
  });

  it("dedups repeated calls with the same cause and originHead", () => {
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    warner.warn("origin-advanced", "sha123", "main");
    warner.warn("origin-advanced", "sha123", "main");
    warner.warn("origin-advanced", "sha123", "main");
    expect(lines).toHaveLength(1);
  });

  it("re-arms when originHead changes for the same cause", () => {
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    warner.warn("origin-advanced", "sha123", "main");
    warner.warn("origin-advanced", "sha456", "main");
    expect(lines).toHaveLength(2);
  });

  it("tracks distinct causes independently for the same originHead", () => {
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    warner.warn("origin-advanced", "sha123", "main");
    warner.warn("build-failed", "sha123", "main");
    expect(lines).toHaveLength(2);
    warner.warn("origin-advanced", "sha123", "main");
    warner.warn("build-failed", "sha123", "main");
    expect(lines).toHaveLength(2);
  });
});
