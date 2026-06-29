import { describe, it, expect } from 'vitest';
import { detectDaemonCommand } from '../../src/engine/daemon-command.js';

// ─────────────────────────────────────────────────────────────────────────────
// RED specs for the NOT-YET-BUILT detectDaemonSupervisorCommand export in
// daemon-command.ts (ADR-014, Batch 2, daemon-supervised-hosting).
//
// Convention: detectDaemonSupervisorCommand is dynamically imported inside each
// test body — a missing export surfaces as THAT test's own RED failure via the
// requireFn guard, rather than a whole-file collection crash.
//
// Also asserts that the EXISTING detectDaemonCommand returns null for each of
// the 5 management verbs (start/stop/restart/connect/debug), so they are never
// dispatched as daemon RUN launches (currently returns DaemonCommandOptions for
// these verbs → these assertions are intentionally RED).
// ─────────────────────────────────────────────────────────────────────────────

const CMD_MOD = '../../src/engine/daemon-command.js';

async function load(): Promise<Record<string, unknown>> {
  // Succeeds (module exists); requireFn below surfaces the missing export.
  return (await import(CMD_MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// argv helper: [node, entry, ...rest]
const argv = (...rest: string[]) => ['node', 'x', ...rest];

const MANAGEMENT_VERBS = ['start', 'stop', 'restart', 'connect', 'debug'] as const;

// ═════════════════════════════════════════════════════════════════════════════
// detectDaemonSupervisorCommand — routes management verbs to {verb}
// ═════════════════════════════════════════════════════════════════════════════
describe('detectDaemonSupervisorCommand: routes management verbs', () => {
  it('returns {verb:"start"} for "daemon start"', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'start'))).toEqual({ verb: 'start' });
  });

  it('returns {verb:"stop"} for "daemon stop"', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'stop'))).toEqual({ verb: 'stop' });
  });

  it('returns {verb:"restart"} for "daemon restart"', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'restart'))).toEqual({ verb: 'restart' });
  });

  it('returns {verb:"connect"} for "daemon connect"', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'connect'))).toEqual({ verb: 'connect' });
  });

  it('returns {verb:"debug"} for "daemon debug"', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'debug'))).toEqual({ verb: 'debug' });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// detectDaemonSupervisorCommand — null for non-management invocations
// ═════════════════════════════════════════════════════════════════════════════
describe('detectDaemonSupervisorCommand: returns null for non-management invocations', () => {
  it('returns null for "daemon status" (observability verb, not management)', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'status'))).toBeNull();
  });

  it('returns null for "daemon logs" (observability verb, not management)', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', 'logs'))).toBeNull();
  });

  it('returns null for "daemon --continuous" (run-mode flag, not management)', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon', '--continuous'))).toBeNull();
  });

  it('returns null for bare "daemon" (run command with no subverb)', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('daemon'))).toBeNull();
  });

  it('returns null when argv[2] is not "daemon" (non-daemon invocation)', async () => {
    const detect = requireFn(await load(), 'detectDaemonSupervisorCommand');
    expect(detect(argv('engineer', 'start'))).toBeNull();
    expect(detect(argv())).toBeNull();
    expect(detect(argv('--daemon'))).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// detectDaemonCommand: must yield null for all 5 management verbs so they are
// never dispatched as daemon RUN launches.  These tests are intentionally RED
// until daemon-command.ts is updated to exclude the management verbs.
// ═════════════════════════════════════════════════════════════════════════════
describe('detectDaemonCommand: yields null for management verbs (never launch a run)', () => {
  for (const verb of MANAGEMENT_VERBS) {
    it(`returns null for "daemon ${verb}" (management verb, not a launch)`, () => {
      expect(detectDaemonCommand(argv('daemon', verb))).toBeNull();
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// detectUnknownDaemonSubcommand: catches a typo'd sub-verb so the CLI shows help
// instead of LAUNCHING a daemon run (the `daemon --help` footgun class).
// ═════════════════════════════════════════════════════════════════════════════
describe('detectUnknownDaemonSubcommand', () => {
  it('returns the token for an unknown non-flag sub-verb (typo)', async () => {
    const detect = requireFn(await load(), 'detectUnknownDaemonSubcommand');
    expect(detect(argv('daemon', 'strt'))).toBe('strt');
    expect(detect(argv('daemon', 'bogus'))).toBe('bogus');
  });

  it('returns null for every known sub-verb (observe + management)', async () => {
    const detect = requireFn(await load(), 'detectUnknownDaemonSubcommand');
    for (const verb of ['status', 'logs', ...MANAGEMENT_VERBS]) {
      expect(detect(argv('daemon', verb))).toBeNull();
    }
  });

  it('returns null for bare "daemon" and flag forms (real run, not a typo)', async () => {
    const detect = requireFn(await load(), 'detectUnknownDaemonSubcommand');
    expect(detect(argv('daemon'))).toBeNull();
    expect(detect(argv('daemon', '--continuous'))).toBeNull();
    expect(detect(argv('daemon', '--help'))).toBeNull(); // help handled separately
    expect(detect(argv('daemon', '-h'))).toBeNull();
  });

  it('returns null when argv[2] is not "daemon"', async () => {
    const detect = requireFn(await load(), 'detectUnknownDaemonSubcommand');
    expect(detect(argv('engineer', 'bogus'))).toBeNull();
    expect(detect(argv())).toBeNull();
  });
});
