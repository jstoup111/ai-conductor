import { describe, it, expect, vi } from 'vitest';
import type { BacklogItem } from '../../src/engine/daemon.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for the WORK-SOURCE seam — NOT YET BUILT.
//
// ADR-014: the daemon run-loop consumes BacklogItems from an injected
// WorkSource. The LOCAL adapter encapsulates today's discoverTick closure
// (daemon-cli.ts lines ~283-292) behind a formalized interface so the run-loop
// is decoupled from direct fs/git calls.
//
// `src/engine/daemon-work-source.ts` does NOT exist yet.
// Each test dynamically imports the module inside its body so the missing
// module surfaces as that test's own RED failure (cannot find module) rather
// than a whole-file collection crash.
//
// Contract (from ADR-014 / daemon-cli.ts discoverTick):
//
//   interface WorkSource {
//     discover(opts: { refresh: boolean }): Promise<BacklogItem[]>;
//   }
//
//   function localWorkSource(deps: LocalWorkSourceDeps): WorkSource
//
//   LocalWorkSourceDeps = {
//     projectRoot:    string,
//     baseBranch:     string,
//     log:            (m: string) => void,
//     isProcessed:    (slug: string) => Promise<boolean>,
//     hasWarned:      (slug: string) => Promise<boolean>,
//     markWarned:     (slug: string) => Promise<void>,
//     fastForwardRoot:(root: string, log: (m: string) => void) => Promise<void>,
//     discoverBacklog:(root: string,
//                      isProcessed: (slug: string) => Promise<boolean>,
//                      log: (m: string) => void,
//                      opts: { baseBranch: string;
//                              hasWarned:  (slug: string) => Promise<boolean>;
//                              markWarned: (slug: string) => Promise<void> })
//                     => Promise<BacklogItem[]>,
//   }
// ─────────────────────────────────────────────────────────────────────────────

const WS_MOD = '../../src/engine/daemon-work-source.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  // Throws (RED) if the module does not exist yet.
  return (await import(modPath)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

/** Minimal BacklogItem stub. */
const fakeItem = (slug: string): BacklogItem => ({ slug });

// ─────────────────────────────────────────────────────────────────────────────
// Fast-forward ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — refresh:true calls fastForwardRoot BEFORE discoverBacklog', () => {
  it('ff fires first, result is forwarded from discoverBacklog', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const callOrder: string[] = [];
    const fakeItems = [fakeItem('x')];

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {
        callOrder.push('ff');
      }),
      discoverBacklog: vi.fn(async () => {
        callOrder.push('discover');
        return fakeItems;
      }),
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: true });

    expect(deps.fastForwardRoot).toHaveBeenCalledTimes(1);
    expect(deps.fastForwardRoot).toHaveBeenCalledWith('/repo', deps.log);
    expect(deps.discoverBacklog).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['ff', 'discover']);
    expect(result).toEqual(fakeItems);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// No fast-forward when refresh:false
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — refresh:false skips fastForwardRoot', () => {
  it('fastForwardRoot is NOT called; discoverBacklog is still called', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(async () => [fakeItem('y')]),
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: false });

    expect(deps.fastForwardRoot).not.toHaveBeenCalled();
    expect(deps.discoverBacklog).toHaveBeenCalledTimes(1);
    expect(result).toEqual([fakeItem('y')]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverBacklog wiring: (projectRoot, isProcessedWrapper, log, opts)
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — discoverBacklog receives correct args + call-through wrappers', () => {
  it('threads projectRoot, log, baseBranch; isProcessed/hasWarned/markWarned wrappers delegate to deps', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const isProcessedSpy = vi.fn().mockResolvedValue(false);
    const hasWarnedSpy = vi.fn().mockResolvedValue(false);
    const markWarnedSpy = vi.fn().mockResolvedValue(undefined);
    const logSpy = vi.fn();

    // Capture the args discoverBacklog receives.
    let capturedRoot: string | undefined;
    let capturedIsProcessed: ((slug: string) => Promise<boolean>) | undefined;
    let capturedLog: unknown;
    let capturedOpts: Record<string, unknown> | undefined;

    const deps = {
      projectRoot: '/my-repo',
      baseBranch: 'trunk',
      log: logSpy,
      isProcessed: isProcessedSpy,
      hasWarned: hasWarnedSpy,
      markWarned: markWarnedSpy,
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(
        async (
          root: string,
          isProc: (s: string) => Promise<boolean>,
          log: unknown,
          opts: unknown,
        ) => {
          capturedRoot = root;
          capturedIsProcessed = isProc;
          capturedLog = log;
          capturedOpts = opts as Record<string, unknown>;
          // Invoke the wrapper so we can assert it delegates to the injected dep.
          await isProc('feat-a');
          return [];
        },
      ),
    };

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });

    // projectRoot and log are forwarded directly.
    expect(capturedRoot).toBe('/my-repo');
    expect(capturedLog).toBe(logSpy);

    // baseBranch is present in opts.
    expect(capturedOpts).toMatchObject({ baseBranch: 'trunk' });

    // isProcessed wrapper delegates to the injected dep.
    expect(isProcessedSpy).toHaveBeenCalledWith('feat-a');

    // hasWarned wrapper delegates.
    const hasWarnedFn = capturedOpts!.hasWarned as (s: string) => Promise<boolean>;
    expect(typeof hasWarnedFn).toBe('function');
    await hasWarnedFn('feat-b');
    expect(hasWarnedSpy).toHaveBeenCalledWith('feat-b');

    // markWarned wrapper delegates.
    const markWarnedFn = capturedOpts!.markWarned as (s: string) => Promise<void>;
    expect(typeof markWarnedFn).toBe('function');
    await markWarnedFn('feat-c');
    expect(markWarnedSpy).toHaveBeenCalledWith('feat-c');
  });
});
