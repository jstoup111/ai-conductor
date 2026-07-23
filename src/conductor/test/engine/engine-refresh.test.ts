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
