import { describe, it, expect } from "vitest";
import {
  createRefreshThrottle,
  createStalenessWarner,
  probeStampedShaBehindOrigin,
} from "../../src/engine/engine-refresh.js";
import type { GitRunner, GitResult } from "../../src/engine/rebase.js";

function fakeGit(handlers: Record<string, GitResult | ((args: string[]) => GitResult)>): GitRunner {
  return async (args: string[]) => {
    const key = args.join(" ");
    // Longest-prefix-wins so e.g. "remote show origin" doesn't accidentally
    // match a shorter "remote" handler registered earlier.
    const matches = Object.entries(handlers)
      .filter(([prefix]) => key.startsWith(prefix))
      .sort((a, b) => b[0].length - a[0].length);
    if (matches.length === 0) {
      throw new Error(`fakeGit: unhandled invocation: ${key}`);
    }
    const handler = matches[0][1];
    return typeof handler === "function" ? handler(args) : handler;
  };
}

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

describe("probeStampedShaBehindOrigin (Task 9, TI-4 HP3/NP3/NP4)", () => {
  const OK = (stdout = ""): GitResult => ({ exitCode: 0, stdout, stderr: "" });
  const FAIL = (stderr = ""): GitResult => ({ exitCode: 1, stdout: "", stderr });

  it("HP3: determinably behind — merge-base --is-ancestor exits 1 (originHead not an ancestor of the stamped sha)", async () => {
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": OK("deadbeef\n"),
      "merge-base --is-ancestor": FAIL(),
    });

    const result = await probeStampedShaBehindOrigin(git, "cafef00d");
    expect(result.outcome).toBe("behind");
    expect(result.originHead).toBe("deadbeef");
    expect(result.defaultBranch).toBe("main");
  });

  it("NP4: up to date — merge-base --is-ancestor exits 0 → current (silent)", async () => {
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": OK("deadbeef\n"),
      "merge-base --is-ancestor": OK(),
    });

    const result = await probeStampedShaBehindOrigin(git, "deadbeef");
    expect(result.outcome).toBe("current");
  });

  it("NP3: missing/unknown stamped sha → undeterminable without any git I/O", async () => {
    const git = fakeGit({}); // any invocation throws — proves no git call is made
    const result = await probeStampedShaBehindOrigin(git, "unknown");
    expect(result.outcome).toBe("undeterminable");

    const result2 = await probeStampedShaBehindOrigin(git, "");
    expect(result2.outcome).toBe("undeterminable");
  });

  it("NP3: no origin remote → undeterminable", async () => {
    const git = fakeGit({
      remote: OK(""), // no 'origin' line
    });
    const result = await probeStampedShaBehindOrigin(git, "cafef00d");
    expect(result.outcome).toBe("undeterminable");
  });

  it("NP3: fetch fails (offline, no prior origin knowledge) → undeterminable", async () => {
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": FAIL("could not resolve host"),
    });
    const result = await probeStampedShaBehindOrigin(git, "cafef00d");
    expect(result.outcome).toBe("undeterminable");
  });

  it("NP3: default branch undiscoverable → undeterminable", async () => {
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": FAIL(),
      "remote show origin": FAIL(),
    });
    const result = await probeStampedShaBehindOrigin(git, "cafef00d");
    expect(result.outcome).toBe("undeterminable");
  });

  it("an ambiguous merge-base result (exit code > 1, e.g. bad object) never claims 'behind'", async () => {
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": OK("deadbeef\n"),
      "merge-base --is-ancestor": { exitCode: 128, stdout: "", stderr: "bad object" },
    });
    const result = await probeStampedShaBehindOrigin(git, "cafef00d");
    expect(result.outcome).toBe("undeterminable");
  });
});

describe("loop-level composition: throttle + probe + warner across boundaries (Task 12)", () => {
  const OK = (stdout = ""): GitResult => ({ exitCode: 0, stdout, stderr: "" });
  const FAIL = (stderr = ""): GitResult => ({ exitCode: 1, stdout: "", stderr });

  /**
   * Simulates one quiescent-boundary tick: consults the throttle first (as
   * production wiring does — Tasks 3/6/7), only performing the fetch/probe
   * and possible warn when the throttle allows it.
   */
  async function runBoundary(
    throttle: ReturnType<typeof createRefreshThrottle>,
    warner: ReturnType<typeof createStalenessWarner>,
    git: GitRunner,
    stampedSha: string,
    fetchCounter: { count: number },
  ): Promise<void> {
    if (!throttle.shouldRun()) return;
    throttle.markRan();
    fetchCounter.count += 1;
    const result = await probeStampedShaBehindOrigin(git, stampedSha);
    if (result.outcome === "behind" && result.originHead && result.defaultBranch) {
      warner.warn("origin-advanced", result.originHead, result.defaultBranch);
    }
  }

  it("repeated quiescent boundaries inside one throttle window: exactly one fetch, zero warnings from throttled-skip boundaries", async () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    const fetchCounter = { count: 0 };
    // Stamp is current w.r.t. origin — the one fetch that does happen must
    // not warn either, so any lines captured would only ever come from a
    // throttled-skip boundary (which must never happen).
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": OK("deadbeef\n"),
      "merge-base --is-ancestor": OK(),
    });

    for (let i = 0; i < 5; i++) {
      await runBoundary(throttle, warner, git, "deadbeef", fetchCounter);
      clock += 500; // well within the 5000ms window
    }

    expect(fetchCounter.count).toBe(1);
    expect(lines).toHaveLength(0);
  });

  it("window expiry: the next boundary after the throttle window elapses performs a fresh fetch", async () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    const fetchCounter = { count: 0 };
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": OK("deadbeef\n"),
      "merge-base --is-ancestor": OK(),
    });

    await runBoundary(throttle, warner, git, "deadbeef", fetchCounter);
    clock += 1000; // inside window — should be a throttled skip
    await runBoundary(throttle, warner, git, "deadbeef", fetchCounter);
    expect(fetchCounter.count).toBe(1);

    clock += 5000; // window has now elapsed
    await runBoundary(throttle, warner, git, "deadbeef", fetchCounter);
    expect(fetchCounter.count).toBe(2);
  });

  it("persistent dirty/stale condition sustained across many boundaries: exactly one warning fires, no re-fire until originHead changes", async () => {
    let clock = 1000;
    const throttle = createRefreshThrottle(5000, () => clock);
    const lines: string[] = [];
    const warner = createStalenessWarner((msg) => lines.push(msg));
    const fetchCounter = { count: 0 };
    let originHead = "deadbeef";
    const git = fakeGit({
      remote: OK("origin\n"),
      "symbolic-ref refs/remotes/origin/HEAD": OK("refs/remotes/origin/main\n"),
      "fetch origin main": OK(),
      "rev-parse origin/main": () => OK(`${originHead}\n`),
      "merge-base --is-ancestor": FAIL(), // determinably behind, every boundary
    });

    // Many boundaries, each past the throttle window so every one actually fetches.
    for (let i = 0; i < 6; i++) {
      clock += 6000; // always past the 5000ms window
      await runBoundary(throttle, warner, git, "cafef00d", fetchCounter);
    }

    expect(fetchCounter.count).toBe(6);
    expect(lines).toHaveLength(1);

    // originHead advances — a new warning is now allowed.
    originHead = "beadfeed";
    clock += 6000;
    await runBoundary(throttle, warner, git, "cafef00d", fetchCounter);
    expect(lines).toHaveLength(2);
  });
});
