// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Background Auto-Intake on the Conduct Loop".
//
// Stories: .docs/stories/background-intake-conduct-loop.md (FR-1..FR-12)
// PRD:     .docs/specs/2026-06-30-background-intake-conduct-loop.md (Approved)
// Plan:    .docs/plans/2026-06-30-background-intake-conduct-loop.md
//
// NONE of this feature's production code exists yet: `intake-loop.ts` (pure-core
// `runIntakeLoop(deps, opts)` + single-tick `intakeTick`) and `notifier.ts`
// (`createNotifier` status-surface + best-effort push) are brand-new modules
// under src/engine/engineer/intake/. Every test below dynamically imports the
// module it needs, so a missing module RREDs only that test with "Cannot find
// module" — the correct RED signal (a top-level static import would instead
// produce a file-collection error, which the skill explicitly disallows as a
// substitute for RED).
//
// What is deliberately NOT re-tested here (already covered elsewhere — see the
// FR coverage table in .pipeline/fr-coverage.md):
//   - FR-6 (empty issue skip) and the ledger/label dedup mechanics underlying
//     FR-2/FR-4, and the per-repo poll failure isolation underlying FR-7, are
//     already exercised at the ADAPTER layer by
//     test/engine/engineer/intake/github-issues.acceptance.test.ts (FR-27/28/
//     34/35/39/40) and test/engine/engineer/intake/ledger.acceptance.test.ts
//     (FR-33/34). This file only adds the LOOP-LEVEL behavior the plan
//     introduces on top of that already-tested adapter: a tick that wires
//     poll → enqueue → route → notify, an interval scheduler, and a
//     notification layer — none of which exist as adapter tests today.
//
// Seams faked here (per the plan: "All effects are injected — poll, enqueue,
// notify, sleep, clock — so the loop is unit-tested with zero real I/O"):
//   - `poll()`      — fake resolving/rejecting with scripted Envelope[] per call
//   - `enqueue()`   — fake recording every envelope handed to it
//   - `notify()`    — fake recording every notify() call and its argument
//   - `sleep()`     — fake recording each requested delay, resolving immediately
//   - `now()`       — fake fixed/incrementing clock
// No real `gh`, no real filesystem status-surface writes, no real tmux/process.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const INTAKE_LOOP_MOD = '../../src/engine/engineer/intake/intake-loop.js';
const NOTIFIER_MOD = '../../src/engine/engineer/intake/notifier.js';
const INTAKE_LOOP_SRC = join(here, '..', '..', 'src', 'engine', 'engineer', 'intake', 'intake-loop.ts');
const NOTIFIER_SRC = join(here, '..', '..', 'src', 'engine', 'engineer', 'intake', 'notifier.ts');
// buildIntake() is the composition-root factory that wires the concrete
// github-issues adapter for the intake path (ADR-008: the engineer loop must
// not import a concrete adapter, but the CLI composition root does). It lives
// in engineer-cli.ts rather than its own module — this is the file to scan.
const BUILD_INTAKE_SRC = join(here, '..', '..', 'src', 'engine', 'engineer-cli.ts');

async function load(modPath: string): Promise<Record<string, any>> {
  return (await import(modPath)) as Record<string, any>;
}
function requireFn(mod: Record<string, any>, name: string): (...a: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...a: any[]) => any;
}

// ── shared envelope + fake-dep helpers ──────────────────────────────────────

function makeEnvelope(sourceRef: string, over: Record<string, unknown> = {}) {
  const [repo] = sourceRef.split('#');
  return {
    id: sourceRef,
    source: 'github-issues',
    sourceRef,
    hintRepo: repo,
    text: `idea for ${sourceRef}`,
    status: 'pending' as const,
    receivedAt: '2026-06-30T00:00:00.000Z',
    ...over,
  };
}

/** Fake poll(): resolves/rejects with the next scripted result per call. */
function makeFakePoll(script: Array<(() => any[]) | 'THROW'>) {
  let i = 0;
  const calls: number[] = [];
  const poll = async () => {
    calls.push(i);
    const step = script[Math.min(i, script.length - 1)];
    i++;
    if (step === 'THROW') throw new Error('poll failed');
    return step();
  };
  return { poll, calls };
}

/** Fake enqueue(): records every envelope handed to it, in order. */
function makeFakeEnqueue() {
  const enqueued: any[] = [];
  return { enqueue: async (env: any) => void enqueued.push(env), enqueued };
}

/** Fake notify(): records every call's argument; can be made to throw once. */
function makeFakeNotify(opts: { throwOnce?: boolean } = {}) {
  const calls: any[][] = [];
  let thrown = false;
  const notify = async (ideas: any[]) => {
    calls.push(ideas);
    if (opts.throwOnce && !thrown) {
      thrown = true;
      throw new Error('push transport unavailable');
    }
  };
  return { notify, calls };
}

/** Fake sleep(): records requested delays, resolves immediately (no real wait). */
function makeFakeSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => void delays.push(ms);
  return { sleep, delays };
}

function makeFakeLog() {
  const lines: string[] = [];
  return { log: (msg: string) => lines.push(msg), lines };
}

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-1, FR-10 — the loop ticks all registered repos on an interval,
// with no human launching the engineer, and honors once/continuous + intervalMs.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-1/FR-10 — a tick polls all repos on an interval without a human', () => {
  it('a single tick with 2 repos worth of envelopes enqueues both and reports {captured: 2}', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1'), makeEnvelope('o/b#7')]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log } = makeFakeLog();

    const summary = await intakeTick({ poll, enqueue, notify, log });

    expect(summary.captured).toBe(2);
    expect(enqueued.map((e) => e.sourceRef).sort()).toEqual(['o/a#1', 'o/b#7']);
  });

  it('N ticks over N configured intervals yields exactly N poll passes (interval-driven, not unbounded)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    const { poll, calls } = makeFakePoll([() => [], () => [], () => []]);
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { sleep, delays } = makeFakeSleep();
    const { log } = makeFakeLog();
    let ticks = 0;
    const sleepAndStop = async (ms: number) => {
      await sleep(ms);
      ticks++;
      if (ticks >= 3) throw { __stop: true };
    };

    await runIntakeLoop(
      { poll, enqueue, notify, sleep: sleepAndStop, now: () => '2026-06-30T00:00:00.000Z', log },
      { intervalMs: 500, once: false },
    ).catch((e: any) => {
      if (!e?.__stop) throw e;
    });

    expect(calls.length).toBe(3);
    expect(delays.every((d) => d === 500)).toBe(true);
  });

  it('no LLM/claude session is spawned by a tick (no such capability is even in the injected deps)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1')]]);
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const deps = { poll, enqueue, notify, log: () => {} };

    await intakeTick(deps);

    // The deps object the tick was actually given carries no route/provider/
    // claude capability at all — there is nothing an implementation could
    // call even if it tried.
    expect(Object.keys(deps)).not.toContain('route');
    expect(Object.keys(deps)).not.toContain('provider');
    expect(Object.keys(deps)).not.toContain('claude');
  });

  it('zero registered repos (poll returns []) completes with zero captures and no error', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => []]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    const summary = await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(summary.captured).toBe(0);
    expect(enqueued).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-2 — each new issue is captured exactly once (loop-level: the tick
// must not itself introduce a duplicate enqueue even when the adapter returns
// one — this is layered ON TOP of the already-tested ledger/adapter dedup in
// test/engine/engineer/intake/github-issues.acceptance.test.ts (FR-34/35) and
// ledger.acceptance.test.ts (FR-33/34), which this file does not re-assert).
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-2 — each captured idea is enqueued exactly once', () => {
  it('an un-recorded issue enqueues exactly one envelope', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1')]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(enqueued).toHaveLength(1);
  });

  it('a duplicate envelope within a single poll pass (same sourceRef twice) enqueues only one', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const dup = makeEnvelope('o/a#1');
    const { poll } = makeFakePoll([() => [dup, { ...dup }]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(enqueued).toHaveLength(1);
  });

  it('two distinct issues with identical title/body text (different sourceRefs) are both enqueued — no text-based false dedup', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const same = { text: 'identical wording' };
    const { poll } = makeFakePoll([
      () => [makeEnvelope('o/a#1', same), makeEnvelope('o/a#2', same)],
    ]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(enqueued.map((e) => e.sourceRef).sort()).toEqual(['o/a#1', 'o/a#2']);
  });

  it('a re-tick over an already-ledger-known issue (adapter returns []) enqueues nothing new', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1')], () => []]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });
    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(enqueued).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-3, FR-8 — captured ideas carry target=origin + source-ref intact,
// so downstream claim/land/handoff can thread it (FR-8's spec-PR-link/auto-close
// chain itself is the existing intake-issue-pr-link mechanism — out of scope
// here; this asserts only that the captured envelope carries what that chain
// needs).
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-3/FR-8 — captured ideas are routed to their origin with source-ref retained', () => {
  it('an envelope from owner/X#7 is enqueued with target=owner/X and sourceRef=owner/X#7', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('owner/X#7', { hintRepo: 'owner/X' })]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(enqueued[0].sourceRef).toBe('owner/X#7');
    expect(enqueued[0].target).toBe('owner/X');
  });

  it('an origin that cannot be resolved is still enqueued (raw source-ref, logged origin-unresolved) — never dropped, never mis-routed', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const orphan = makeEnvelope('unregistered/repo#3', { hintRepo: undefined });
    const { poll } = makeFakePoll([() => [orphan]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log, lines } = makeFakeLog();

    await intakeTick({ poll, enqueue, notify, log });

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].sourceRef).toBe('unregistered/repo#3');
    expect(lines.some((l) => /origin-unresolved/i.test(l))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-5, FR-12 — the operator is notified once per newly captured
// batch, never for an empty pass, never twice for the same idea, and a
// notification-transport failure never rolls back capture.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-5/FR-12 — operator notification is batched, deduplicated, and failure-isolated', () => {
  it('a non-empty capture pass triggers exactly one notify() call describing the new work', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1'), makeEnvelope('o/a#2')]]);
    const { enqueue } = makeFakeEnqueue();
    const { notify, calls } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(calls).toHaveLength(1);
    expect(calls[0].map((e: any) => e.sourceRef).sort()).toEqual(['o/a#1', 'o/a#2']);
  });

  it('an empty capture pass triggers no notify() call (no empty-pass spam)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => []]);
    const { enqueue } = makeFakeEnqueue();
    const { notify, calls } = makeFakeNotify();

    await intakeTick({ poll, enqueue, notify, log: () => {} });

    expect(calls).toHaveLength(0);
  });

  it('a notify() failure is caught and logged; captures are still persisted (non-fatal, non-rollback)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1')]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify({ throwOnce: true });
    const { log, lines } = makeFakeLog();

    await expect(intakeTick({ poll, enqueue, notify, log })).resolves.not.toThrow();

    expect(enqueued).toHaveLength(1); // capture is not rolled back
    expect(lines.some((l) => /notif/i.test(l))).toBe(true);
  });

  it('the notifier itself never re-notifies an already-surfaced idea (FR-12): notify {A,B} then {A,B,C} pushes only C', async () => {
    const mod = await load(NOTIFIER_MOD);
    const createNotifier = requireFn(mod, 'createNotifier');
    const pushed: any[][] = [];
    const statusWrites: any[] = [];
    const notifier = createNotifier({
      writeStatus: async (s: any) => void statusWrites.push(s),
      push: async (ideas: any[]) => void pushed.push(ideas),
      now: () => '2026-06-30T00:00:00.000Z',
    });
    const A = makeEnvelope('o/a#1');
    const B = makeEnvelope('o/a#2');
    const C = makeEnvelope('o/a#3');

    await notifier.notify([A, B]);
    await notifier.notify([A, B, C]);

    const secondPushRefs = pushed[1]?.map((e: any) => e.sourceRef) ?? [];
    expect(secondPushRefs).toEqual(['o/a#3']);
  });

  it('re-notifying the exact same already-surfaced set pushes nothing', async () => {
    const mod = await load(NOTIFIER_MOD);
    const createNotifier = requireFn(mod, 'createNotifier');
    const pushed: any[][] = [];
    const notifier = createNotifier({
      writeStatus: async () => {},
      push: async (ideas: any[]) => void pushed.push(ideas),
      now: () => '2026-06-30T00:00:00.000Z',
    });
    const A = makeEnvelope('o/a#1');

    await notifier.notify([A]);
    await notifier.notify([A]);

    expect(pushed).toHaveLength(1); // only the first call pushed anything
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-7 — a failing repo (or a whole-tick failure) is isolated and the
// loop never crashes. Per-repo isolation itself is already proven at the
// adapter layer (github-issues.acceptance.test.ts FR-27); this asserts the
// LOOP wraps poll() defensively and keeps ticking across intervals.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-7 — a poll failure is isolated; the loop never crashes', () => {
  it('a tick whose poll() rejects is caught, logged, and completes with zero captures (no throw escapes)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll(['THROW']);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log, lines } = makeFakeLog();

    const summary = await intakeTick({ poll, enqueue, notify, log });

    expect(summary.captured).toBe(0);
    expect(enqueued).toEqual([]);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('every interval failing to poll still lets the loop reach its 3rd iteration (does not crash / does not stop)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    const { poll, calls } = makeFakePoll(['THROW', 'THROW', 'THROW']);
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log } = makeFakeLog();
    let ticks = 0;
    const sleepAndStop = async () => {
      ticks++;
      if (ticks >= 3) throw { __stop: true };
    };

    await runIntakeLoop(
      { poll, enqueue, notify, sleep: sleepAndStop, now: () => '2026-06-30T00:00:00.000Z', log },
      { intervalMs: 100, once: false },
    ).catch((e: any) => {
      if (!e?.__stop) throw e;
    });

    expect(calls.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-9 — polling/routing/notification perform no LLM/token work. A
// static import-scan: if intake-loop.ts/notifier.ts don't exist yet, readFile
// itself throws (ENOENT) — a valid RED. Once they exist, this guards against a
// regression pulling in a provider/claude-session dependency.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-9 — the intake loop path imports no LLM/provider module', () => {
  it('intake-loop.ts does not statically import a routing provider or claude-session adapter', async () => {
    const src = await readFile(INTAKE_LOOP_SRC, 'utf8');
    expect(src).not.toMatch(/from ['"][^'"]*routing(\.js)?['"]/);
    expect(src).not.toMatch(/RoutingProvider/);
    expect(src).not.toMatch(/from ['"][^'"]*claude-session(\.js)?['"]/);
  });

  it('notifier.ts does not statically import a routing provider or claude-session adapter', async () => {
    const src = await readFile(NOTIFIER_SRC, 'utf8');
    expect(src).not.toMatch(/from ['"][^'"]*routing(\.js)?['"]/);
    expect(src).not.toMatch(/RoutingProvider/);
    expect(src).not.toMatch(/from ['"][^'"]*claude-session(\.js)?['"]/);
  });

  it('a tick capturing several ideas records zero notify/enqueue calls to anything resembling a model client', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1'), makeEnvelope('o/a#2')]]);
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const deps: Record<string, unknown> = { poll, enqueue, notify, log: () => {} };

    await intakeTick(deps);

    expect(Object.keys(deps).some((k) => /model|llm|provider|claude/i.test(k))).toBe(false);
  });

  // Task 15 — zero-token guard, broadened patterns + buildIntake's composition
  // root (engineer-cli.ts). This is a static import-scan (readFile + regex),
  // never a dynamic import: a dynamic import would only prove the module
  // *resolves*, not that its source text is free of provider/LLM imports.
  const NO_PROVIDER_IMPORT_PATTERNS: RegExp[] = [
    // @anthropic-ai/sdk or any claude-* module (e.g. claude-session.js)
    /from\s+['"](?:@anthropic-ai\/sdk|[^'"]*\bclaude-[^'"]*)['"]/i,
    // a routing adapter module or the RoutingProvider type/class itself
    /from\s+['"][^'"]*\brouting[^'"]*['"]/i,
    /\bRoutingProvider\b/,
    // a session-cache module or the SessionCache type/class itself
    /from\s+['"][^'"]*\bsession-?cache[^'"]*['"]/i,
    /\bSessionCache\b/,
    // any generic "provider" API module import
    /from\s+['"][^'"]*\bprovider[^'"]*['"]/i,
  ];

  function assertNoProviderImports(src: string, label: string): void {
    for (const pattern of NO_PROVIDER_IMPORT_PATTERNS) {
      expect(src, `${label} must not match ${pattern} (zero-token guard)`).not.toMatch(pattern);
    }
  }

  it('intake-loop.ts imports no LLM/provider module (broadened pattern set)', async () => {
    const src = await readFile(INTAKE_LOOP_SRC, 'utf8');
    assertNoProviderImports(src, 'intake-loop.ts');
  });

  it('notifier.ts imports no LLM/provider module (broadened pattern set)', async () => {
    const src = await readFile(NOTIFIER_SRC, 'utf8');
    assertNoProviderImports(src, 'notifier.ts');
  });

  it("buildIntake's composition root (engineer-cli.ts) imports no @anthropic-ai/sdk, RoutingProvider, or SessionCache", async () => {
    const src = await readFile(BUILD_INTAKE_SRC, 'utf8');
    // engineer-cli.ts is the CLI entrypoint and legitimately spawns an
    // interactive `claude /engineer` session as a subprocess (ADR-008) — that
    // is process spawning, not an in-process LLM/provider import, so it is
    // not covered by these patterns. What must never appear is a direct
    // import of an SDK/provider/session-cache module into the intake path.
    expect(src).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/i);
    expect(src).not.toMatch(/\bRoutingProvider\b/);
    expect(src).not.toMatch(/\bSessionCache\b/);
    expect(src).not.toMatch(/from\s+['"][^'"]*\bsession-?cache[^'"]*['"]/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-11 — the loop stops at "routed + notified"; it never runs DECIDE
// or opens a spec PR unattended, and unclaimed ideas persist rather than being
// auto-processed or dropped.
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-11 — the loop never runs DECIDE or opens a spec PR unattended', () => {
  it('across 5 ticks with captures every time, the deps object never carries a land/handoff/openPr capability', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    let n = 0;
    const { poll } = makeFakePoll(Array.from({ length: 5 }, () => () => [makeEnvelope(`o/a#${n++}`)]));
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log } = makeFakeLog();
    let ticks = 0;
    const sleepAndStop = async () => {
      ticks++;
      if (ticks >= 5) throw { __stop: true };
    };
    const deps = { poll, enqueue, notify, sleep: sleepAndStop, now: () => '2026-06-30T00:00:00.000Z', log };

    await runIntakeLoop(deps, { intervalMs: 10, once: false }).catch((e: any) => {
      if (!e?.__stop) throw e;
    });

    expect(Object.keys(deps)).not.toContain('land');
    expect(Object.keys(deps)).not.toContain('handoff');
    expect(Object.keys(deps)).not.toContain('openPr');
    expect(Object.keys(deps)).not.toContain('decide');
  });

  it('an idea left unclaimed across many ticks is never re-processed by the loop and is never dropped (enqueued exactly once)', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const intakeTick = requireFn(mod, 'intakeTick');
    const { poll } = makeFakePoll([() => [makeEnvelope('o/a#1')], () => [], () => [], () => []]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();

    for (let i = 0; i < 4; i++) {
      await intakeTick({ poll, enqueue, notify, log: () => {} });
    }

    expect(enqueued).toHaveLength(1); // still just the one capture — persisted, not re-enqueued, not dropped
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Covers: FR-10 — the poll interval is operator-configurable with a documented
// default, and an invalid interval falls back to the default (logged, no
// busy-loop / no crash).
// ─────────────────────────────────────────────────────────────────────────────
describe('FR-10 — the poll interval is configurable with a validated default fallback', () => {
  it('a configured intervalMs is honored on every sleep() call', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    const { poll } = makeFakePoll([() => [], () => []]);
    const { enqueue } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const { log } = makeFakeLog();
    const delays: number[] = [];
    let ticks = 0;
    const sleepAndStop = async (ms: number) => {
      delays.push(ms);
      ticks++;
      if (ticks >= 2) throw { __stop: true };
    };

    await runIntakeLoop(
      { poll, enqueue, notify, sleep: sleepAndStop, now: () => '2026-06-30T00:00:00.000Z', log },
      { intervalMs: 12345, once: false },
    ).catch((e: any) => {
      if (!e?.__stop) throw e;
    });

    expect(delays.every((d) => d === 12345)).toBe(true);
  });

  it('once:true runs exactly one tick regardless of intervalMs', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    const { poll, calls } = makeFakePoll([() => [makeEnvelope('o/a#1')]]);
    const { enqueue, enqueued } = makeFakeEnqueue();
    const { notify } = makeFakeNotify();
    const sleep = async () => {
      throw new Error('sleep must never be called when once:true');
    };

    await runIntakeLoop(
      { poll, enqueue, notify, sleep, now: () => '2026-06-30T00:00:00.000Z', log: () => {} },
      { intervalMs: 500, once: true },
    );

    expect(calls.length).toBe(1);
    expect(enqueued).toHaveLength(1);
  });

  it('an invalid intervalMs (0, negative, or NaN) falls back to a documented default and logs the rejected value — no busy-loop, no throw', async () => {
    const mod = await load(INTAKE_LOOP_MOD);
    const runIntakeLoop = requireFn(mod, 'runIntakeLoop');
    for (const bad of [0, -5, NaN]) {
      const { poll } = makeFakePoll([() => []]);
      const { enqueue } = makeFakeEnqueue();
      const { notify } = makeFakeNotify();
      const { log, lines } = makeFakeLog();
      const delays: number[] = [];
      const sleepAndStop = async (ms: number) => {
        delays.push(ms);
        throw { __stop: true };
      };

      await runIntakeLoop(
        { poll, enqueue, notify, sleep: sleepAndStop, now: () => '2026-06-30T00:00:00.000Z', log },
        { intervalMs: bad, once: false },
      ).catch((e: any) => {
        if (!e?.__stop) throw e;
      });

      expect(delays[0], `intervalMs=${bad} must fall back to a positive default`).toBeGreaterThan(0);
      expect(lines.some((l) => /interval/i.test(l)), `intervalMs=${bad} must log the rejected value`).toBe(
        true,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 17 — production `runIntakeLoop` wiring + `intake-loop` CLI subcommand.
//
// `detectIntakeLoopCommand` recognizes `intake-loop --continuous` / `--once`;
// `dispatchIntakeLoop` is the PRODUCTION composition root that wires the real
// `buildIntake()` adapter, a real `createNotifier`, a real `sleep`/`now`, and
// `console.log` into `runIntakeLoop`. It never spawns claude and never opens a
// PR (FR-9/FR-11). Here we mock `buildIntake`/`createNotifier`/`sleep` via the
// injected-deps seams on `dispatchIntakeLoop` so the test drives exactly one
// tick with zero real I/O, then statically re-confirms the zero-token guard.
// ─────────────────────────────────────────────────────────────────────────────
describe('Task 17 — intake-loop CLI subcommand (production wiring)', () => {
  const CLI_MOD = '../../src/intake-loop-cli.js';
  const CLI_SRC = join(here, '..', '..', 'src', 'intake-loop-cli.ts');

  it('detectIntakeLoopCommand recognizes "intake-loop --continuous"', async () => {
    const mod = await load(CLI_MOD);
    const detect = requireFn(mod, 'detectIntakeLoopCommand');
    expect(detect(['node', 'conduct', 'intake-loop', '--continuous'])).toMatchObject({
      kind: 'run',
      once: false,
    });
  });

  it('detectIntakeLoopCommand recognizes "intake-loop --once"', async () => {
    const mod = await load(CLI_MOD);
    const detect = requireFn(mod, 'detectIntakeLoopCommand');
    expect(detect(['node', 'conduct', 'intake-loop', '--once'])).toMatchObject({
      kind: 'run',
      once: true,
    });
  });

  it('detectIntakeLoopCommand returns null for an unrelated subcommand', async () => {
    const mod = await load(CLI_MOD);
    const detect = requireFn(mod, 'detectIntakeLoopCommand');
    expect(detect(['node', 'conduct', 'engineer'])).toBeNull();
  });

  it('detectIntakeLoopCommand returns {kind:"guide"} when neither flag is given', async () => {
    const mod = await load(CLI_MOD);
    const detect = requireFn(mod, 'detectIntakeLoopCommand');
    expect(detect(['node', 'conduct', 'intake-loop'])).toEqual({ kind: 'guide' });
  });

  it('dispatchIntakeLoop({once:true}) dispatches the real loop for exactly one tick using mocked buildIntake/notifier/sleep', async () => {
    const mod = await load(CLI_MOD);
    const dispatch = requireFn(mod, 'dispatchIntakeLoop');

    const polled = { count: 0 };
    const fakeAdapter = {
      poll: async () => {
        polled.count++;
        return [makeEnvelope('o/a#1')];
      },
    };
    const enqueued: any[] = [];
    const fakeQueue = { enqueue: async (e: any) => void enqueued.push(e) };
    const fakeBuildIntake = () => ({
      reader: {} as any,
      ledger: {} as any,
      queue: fakeQueue as any,
      adapter: fakeAdapter as any,
    });

    const notified: any[] = [];
    const fakeCreateNotifier = (deps: any) => ({
      notify: async (ideas: any[]) => {
        notified.push(ideas);
        await deps.writeStatus({ count: ideas.length, sourceRefs: [], timestamp: deps.now(), message: 'x' });
      },
    });

    let sleepCalls = 0;
    const fakeSleep = async () => {
      sleepCalls++;
    };

    const code = await dispatch(
      { kind: 'run', once: true, intervalMs: 999 },
      {
        buildIntake: fakeBuildIntake as any,
        createNotifier: fakeCreateNotifier as any,
        sleep: fakeSleep,
        now: () => new Date('2026-06-30T00:00:00.000Z'),
        log: () => {},
        printErr: () => {},
        engineerDir: '/tmp/does-not-matter-for-this-test',
      },
    );

    expect(code).toBe(0);
    expect(polled.count).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(notified).toHaveLength(1);
    expect(sleepCalls).toBe(0);
  });

  it('Production push transport wiring: sends notification for new ideas', async () => {
    const mod = await load(CLI_MOD);
    const dispatch = requireFn(mod, 'dispatchIntakeLoop');

    const polled = { count: 0 };
    const fakeAdapter = {
      poll: async () => {
        polled.count++;
        return [makeEnvelope('o/a#1')];
      },
    };
    const enqueued: any[] = [];
    const fakeQueue = { enqueue: async (e: any) => void enqueued.push(e) };
    const fakeBuildIntake = () => ({
      reader: {} as any,
      ledger: {} as any,
      queue: fakeQueue as any,
      adapter: fakeAdapter as any,
    });

    let sleepCalls = 0;
    const fakeSleep = async () => {
      sleepCalls++;
    };

    const sendNotification = vi.fn();

    const code = await dispatch(
      { kind: 'run', once: true, intervalMs: 999 },
      {
        buildIntake: fakeBuildIntake as any,
        sendNotification,
        sleep: fakeSleep,
        now: () => new Date('2026-06-30T00:00:00.000Z'),
        log: () => {},
        printErr: () => {},
        engineerDir: '/tmp/test-push-notification-wiring',
      },
    );

    expect(code).toBe(0);
    expect(polled.count).toBe(1);
    expect(enqueued).toHaveLength(1);
    expect(sleepCalls).toBe(0);

    // Verify sendNotification was called exactly once with the correct message
    expect(sendNotification).toHaveBeenCalledTimes(1);
    const [callTitle, callMessage] = sendNotification.mock.calls[0];
    expect(callTitle).toBe('Intake: new ideas queued');
    expect(callMessage).toContain('1 new idea(s)');
    expect(callMessage).toContain('o/a#1');
  });

  it('Production push transport wiring: no notification when poll is empty', async () => {
    const mod = await load(CLI_MOD);
    const dispatch = requireFn(mod, 'dispatchIntakeLoop');

    const polled = { count: 0 };
    const fakeAdapter = {
      poll: async () => {
        polled.count++;
        return [];
      },
    };
    const enqueued: any[] = [];
    const fakeQueue = { enqueue: async (e: any) => void enqueued.push(e) };
    const fakeBuildIntake = () => ({
      reader: {} as any,
      ledger: {} as any,
      queue: fakeQueue as any,
      adapter: fakeAdapter as any,
    });

    let sleepCalls = 0;
    const fakeSleep = async () => {
      sleepCalls++;
    };

    const sendNotification = vi.fn();

    const code = await dispatch(
      { kind: 'run', once: true, intervalMs: 999 },
      {
        buildIntake: fakeBuildIntake as any,
        sendNotification,
        sleep: fakeSleep,
        now: () => new Date('2026-06-30T00:00:00.000Z'),
        log: () => {},
        printErr: () => {},
        engineerDir: '/tmp/test-push-no-notification-empty',
      },
    );

    expect(code).toBe(0);
    expect(polled.count).toBe(1);
    expect(enqueued).toHaveLength(0);
    expect(sleepCalls).toBe(0);

    // Verify sendNotification was never called when there are no new ideas
    expect(sendNotification).toHaveBeenCalledTimes(0);
  });

  it('dispatchIntakeLoop wires IntakeLoopDeps.reconcile bound to the real ledger/queue + a getIssueState gh capability', async () => {
    const mod = await load(CLI_MOD);
    const dispatch = requireFn(mod, 'dispatchIntakeLoop');

    // Fake ledger with one pending github-issues entry backing a closed issue.
    const ledgerEntries = [
      { source: 'github-issues', sourceRef: 'o/a#1', status: 'pending' },
    ];
    const forgotten: any[] = [];
    const fakeLedger = {
      list: async () => ledgerEntries,
      forget: async (source: string, sourceRef: string) => {
        forgotten.push({ source, sourceRef });
      },
    };
    const removed: any[] = [];
    const fakeQueue = {
      enqueue: async () => {},
      list: async () => [{ source: 'github-issues', sourceRef: 'o/a#1' }],
      remove: async (e: any) => void removed.push(e),
    };
    const fakeAdapter = { poll: async () => [] };
    const fakeBuildIntake = () => ({
      reader: {} as any,
      ledger: fakeLedger as any,
      queue: fakeQueue as any,
      adapter: fakeAdapter as any,
    });

    // Fake gh runner: reports issue o/a#1 as closed.
    const ghCalls: any[] = [];
    const fakeGh = async (args: string[], _opts: { cwd: string }) => {
      ghCalls.push(args);
      return { stdout: 'closed' };
    };

    let capturedDeps: any;
    const fakeRunIntakeLoop = async (deps: any) => {
      capturedDeps = deps;
    };

    await dispatch(
      { kind: 'run', once: true, intervalMs: 999 },
      {
        buildIntake: fakeBuildIntake as any,
        runIntakeLoop: fakeRunIntakeLoop as any,
        gh: fakeGh as any,
        now: () => new Date('2026-06-30T00:00:00.000Z'),
        log: () => {},
        printErr: () => {},
        engineerDir: '/tmp/test-reconcile-wiring',
      },
    );

    expect(typeof capturedDeps.reconcile).toBe('function');

    const summary = await capturedDeps.reconcile();

    expect(ghCalls.length).toBeGreaterThan(0);
    expect(forgotten).toEqual([{ source: 'github-issues', sourceRef: 'o/a#1' }]);
    expect(removed).toHaveLength(1);
    expect(summary).toMatchObject({ scanned: 1, forgotten: 1, errors: 0 });
  });

  it('dispatchIntakeLoop imports no LLM/provider/claude-session module (zero-token guard)', async () => {
    const src = await readFile(CLI_SRC, 'utf8');
    expect(src).not.toMatch(/from\s+['"](?:@anthropic-ai\/sdk|[^'"]*\bclaude-[^'"]*)['"]/i);
    expect(src).not.toMatch(/\bRoutingProvider\b/);
    expect(src).not.toMatch(/\bSessionCache\b/);
    expect(src).not.toMatch(/from\s+['"][^'"]*\bsession-?cache[^'"]*['"]/i);
  });
});
