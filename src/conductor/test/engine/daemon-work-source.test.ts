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
        return { items: fakeItems, waiting: [] };
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
      discoverBacklog: vi.fn(async () => ({ items: [fakeItem('y')], waiting: [] })),
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
          return { items: [], waiting: [] };
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

// ─────────────────────────────────────────────────────────────────────────────
// Owner-gate threading (Task 17): the daemonOwner / readStamp / readMergeTime /
// cutover deps are threaded through into discoverBacklog opts. When the gate is
// UNWIRED (no resolveDaemonOwner thunk) the opts stay legacy (no gate keys).
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — owner-gate deps thread into discoverBacklog opts', () => {
  function baseDeps(overrides: Record<string, unknown> = {}) {
    let capturedOpts: Record<string, unknown> | undefined;
    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(async (_r: string, _p: unknown, _l: unknown, opts: unknown) => {
        capturedOpts = opts as Record<string, unknown>;
        return { items: [], waiting: [] };
      }),
      ...overrides,
    };
    return { deps, getOpts: () => capturedOpts };
  }

  it('threads a RESOLVED daemonOwner + readStamp/readMergeTime/cutover into opts', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const readStamp = vi.fn().mockResolvedValue({ present: true, id: 'alice' });
    const readMergeTime = vi.fn().mockResolvedValue('2026-06-29T00:00:00Z');
    const { deps, getOpts } = baseDeps({
      resolveDaemonOwner: vi.fn().mockResolvedValue({ resolved: true, id: 'alice' }),
      readStamp,
      readMergeTime,
      cutover: '2026-06-30T00:00:00Z',
    });

    await localWorkSource(deps).discover({ refresh: false });

    const opts = getOpts()!;
    expect(opts.daemonOwner).toEqual({ resolved: true, id: 'alice' });
    expect(opts.readStamp).toBe(readStamp);
    expect(opts.readMergeTime).toBe(readMergeTime);
    expect(opts.cutover).toBe('2026-06-30T00:00:00Z');
  });

  it('threads an UNRESOLVED daemonOwner (fail-closed downstream) — the gate is still wired', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const { deps, getOpts } = baseDeps({
      resolveDaemonOwner: vi.fn().mockResolvedValue({ resolved: false }),
      readStamp: vi.fn(),
      readMergeTime: vi.fn(),
      cutover: null,
    });

    await localWorkSource(deps).discover({ refresh: false });

    const opts = getOpts()!;
    // An explicit {resolved:false} must still reach discoverBacklog so it can
    // fail-CLOSED + warn-once (not be silently dropped as "no gate").
    expect(opts.daemonOwner).toEqual({ resolved: false });
    expect(opts.cutover).toBeNull();
  });

  it('defaults a missing cutover to null (documented default) when the gate is wired', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const { deps, getOpts } = baseDeps({
      resolveDaemonOwner: vi.fn().mockResolvedValue({ resolved: true, id: 'alice' }),
      readStamp: vi.fn(),
      readMergeTime: vi.fn(),
      // cutover omitted entirely
    });

    await localWorkSource(deps).discover({ refresh: false });
    expect(getOpts()!.cutover).toBeNull();
  });

  it('UNWIRED gate (no resolveDaemonOwner) leaves opts legacy — no gate keys', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const { deps, getOpts } = baseDeps();
    await localWorkSource(deps).discover({ refresh: false });

    const opts = getOpts()!;
    expect('daemonOwner' in opts).toBe(false);
    expect('cutover' in opts).toBe(false);
    expect(opts).toMatchObject({ baseBranch: 'main' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Fresh per-pass resolution (Task 18 / FR-14): the daemon owner is resolved on
// EVERY discover() pass — there is no cross-pass cache. A reconfigured identity
// takes effect on the next pass.
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — resolveDaemonOwner is called FRESH on every pass (no cache)', () => {
  it('invokes the resolver once per discover() and forwards the current owner', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    let capturedOwner: unknown;
    // Simulate a reconfiguration between passes: alice → alice2.
    const owners = [
      { resolved: true, id: 'alice' },
      { resolved: true, id: 'alice2' },
    ];
    let pass = 0;
    const resolveDaemonOwner = vi.fn(async () => owners[pass++]);

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      resolveDaemonOwner,
      readStamp: vi.fn(),
      readMergeTime: vi.fn(),
      cutover: null,
      discoverBacklog: vi.fn(async (_r: string, _p: unknown, _l: unknown, opts: unknown) => {
        capturedOwner = (opts as Record<string, unknown>).daemonOwner;
        return { items: [], waiting: [] };
      }),
    };

    const source = localWorkSource(deps);
    await source.discover({ refresh: false });
    expect(capturedOwner).toEqual({ resolved: true, id: 'alice' });
    await source.discover({ refresh: false });
    expect(capturedOwner).toEqual({ resolved: true, id: 'alice2' });

    // Called exactly once per pass — no memoization across passes.
    expect(resolveDaemonOwner).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Priority resolver wiring (Task 11): the priorityResolver is called AFTER
// discoverBacklog (post-gate) to order the backlog by priority bands. When the
// resolver is UNWIRED the order stays legacy (no reordering).
// ─────────────────────────────────────────────────────────────────────────────

describe('localWorkSource — priority resolver wiring (post-gate ordering)', () => {
  it('resolves items with resolver: returns banded order after gate', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    // Mock items from discoverBacklog in original order (with sourceRef for priority lookup)
    const originalItems = [
      { slug: 'low-item', sourceRef: 'owner/repo#1' },
      { slug: 'high-item', sourceRef: 'owner/repo#2' },
      { slug: 'med-item', sourceRef: 'owner/repo#3' },
    ];

    // Mock resolver that returns banded resolution (keyed by sourceRef)
    const priorityResolver = {
      resolve: vi.fn(async () => ({
        mode: 'banded' as const,
        bands: new Map([
          ['owner/repo#1', 'low'],
          ['owner/repo#2', 'high'],
          ['owner/repo#3', 'medium'],
        ]),
      })),
    };

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(async () => ({ items: originalItems, waiting: [] })),
      priorityResolver,
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: true });

    // Resolver should be called with refresh:true and the items from discoverBacklog
    expect(priorityResolver.resolve).toHaveBeenCalledWith(originalItems, { refresh: true });

    // Result should be reordered: high → medium → low
    expect(result).toHaveLength(3);
    expect(result[0].slug).toBe('high-item');
    expect(result[1].slug).toBe('med-item');
    expect(result[2].slug).toBe('low-item');
  });

  it('resolver called AFTER gate: empty backlog → zero reader calls (fail-closed)', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    // Simulate a gate that filters all items out
    const callOrder: string[] = [];
    const priorityResolver = {
      resolve: vi.fn(async () => {
        callOrder.push('resolver-called');
        return { mode: 'fallback' as const };
      }),
    };

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
        // Gate filters everything out
        return { items: [], waiting: [] };
      }),
      priorityResolver,
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: true });

    // Verify call order: ff → discover → resolver (even with empty backlog)
    expect(callOrder).toEqual(['ff', 'discover', 'resolver-called']);
    expect(result).toEqual([]);
  });

  it('without resolver (legacy): returns items byte-identical to before', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const originalItems = [fakeItem('b'), fakeItem('a'), fakeItem('c')];

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(async () => ({ items: originalItems, waiting: [] })),
      // NO priorityResolver
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: false });

    // Without resolver, order should be IDENTICAL to what came from discoverBacklog
    expect(result).toEqual(originalItems);
    expect(result).toStrictEqual(originalItems);
  });

  it('eligibility set unchanged: resolver orders but does not change membership', async () => {
    const mod = await load(WS_MOD);
    const localWorkSource = requireFn(mod, 'localWorkSource');

    const originalItems = [
      { slug: 'a', sourceRef: 'owner/repo#1' },
      { slug: 'b', sourceRef: 'owner/repo#2' },
      { slug: 'c', sourceRef: 'owner/repo#3' },
    ];

    const priorityResolver = {
      resolve: vi.fn(async () => ({
        mode: 'banded' as const,
        bands: new Map([
          ['owner/repo#1', 'low'],
          ['owner/repo#2', 'high'],
          ['owner/repo#3', 'medium'],
        ]),
      })),
    };

    const deps = {
      projectRoot: '/repo',
      baseBranch: 'main',
      log: vi.fn(),
      isProcessed: vi.fn().mockResolvedValue(false),
      hasWarned: vi.fn().mockResolvedValue(false),
      markWarned: vi.fn().mockResolvedValue(undefined),
      fastForwardRoot: vi.fn(async () => {}),
      discoverBacklog: vi.fn(async () => ({ items: originalItems, waiting: [] })),
      priorityResolver,
    };

    const source = localWorkSource(deps);
    const result = await source.discover({ refresh: false });

    // Eligibility set (count and members) must be identical
    expect(result).toHaveLength(originalItems.length);
    const originalSlugs = new Set(originalItems.map((i) => i.slug));
    const resultSlugs = new Set(result.map((i) => i.slug));
    expect(resultSlugs).toEqual(originalSlugs);
  });
});
