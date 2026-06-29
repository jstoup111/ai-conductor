import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED acceptance specs for "Daemon supervised hosting" (PR #143, ADR-014).
//
// These drive the REAL entry points the feature must wire — the CLI verb router
// and the Supervisor port — not the helpers in isolation (writing-system-tests
// §3b/§3d: a replacement task ships an orphaned primitive when only the new unit
// is tested while the live path still calls the old code). Every test dynamically
// imports the symbol it needs INSIDE the test body, so a not-yet-built module
// surfaces as THAT test's RED failure rather than a whole-file collection crash.
//
// Modules under contract (do not exist yet → genuine RED):
//   src/engine/daemon-tmux.ts     — Supervisor port + tmux adapter (injected runner)
//   src/engine/daemon-command.ts  — detectDaemonSupervisorCommand (new verb router)
// ─────────────────────────────────────────────────────────────────────────────

const TMUX_MOD = '../../src/engine/daemon-tmux.js';
const CMD_MOD = '../../src/engine/daemon-command.js';

async function load(modPath: string): Promise<Record<string, unknown>> {
  return (await import(modPath)) as Record<string, unknown>;
}
function requireFn(mod: Record<string, unknown>, name: string): (...a: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...a: any[]) => any;
}

/** Spy tmux runner: records argv + inherit flag, returns canned results keyed by subcommand. */
function spyRunner(results: Record<string, { code: number; stdout?: string }> = {}) {
  const calls: { args: string[]; inherit: boolean }[] = [];
  const run = (args: string[], opts: { inherit: boolean }) => {
    calls.push({ args, inherit: opts.inherit });
    const r = results[args[0]] ?? { code: 0, stdout: '' };
    return { code: r.code, stdout: r.stdout ?? '' };
  };
  return { run, calls };
}
const argvOf = (calls: { args: string[] }[], sub: string) =>
  calls.map((c) => c.args).find((a) => a[0] === sub);

// ─────────────────────────────────────────────────────────────────────────────
// FR-15 — management verbs route to the supervisor, NEVER to a daemon run / build.
// (The exact mis-route class the bin/conduct + index.ts routing fix must close.)
// ─────────────────────────────────────────────────────────────────────────────
describe('Daemon management routing (FR-15)', () => {
  const VERBS = ['start', 'stop', 'restart', 'connect', 'debug'];

  it('detectDaemonSupervisorCommand recognizes every management verb', async () => {
    const detect = requireFn(await load(CMD_MOD), 'detectDaemonSupervisorCommand');
    for (const verb of VERBS) {
      const cmd = detect(['node', 'conduct-ts', 'daemon', verb]);
      expect(cmd, `verb "${verb}" must be recognized`).toBeTruthy();
      expect(cmd.verb).toBe(verb);
    }
  });

  it('detectDaemonSupervisorCommand returns null for a daemon RUN and for non-daemon argv', async () => {
    const detect = requireFn(await load(CMD_MOD), 'detectDaemonSupervisorCommand');
    expect(detect(['node', 'conduct-ts', 'daemon', '--continuous'])).toBeNull();
    expect(detect(['node', 'conduct-ts', 'daemon'])).toBeNull();
    expect(detect(['node', 'conduct-ts', 'some feature description'])).toBeNull();
  });

  it('detectDaemonCommand returns null for management verbs so they never launch a run/build', async () => {
    const detectRun = requireFn(await load(CMD_MOD), 'detectDaemonCommand');
    for (const verb of VERBS) {
      expect(
        detectRun(['node', 'conduct-ts', 'daemon', verb]),
        `"daemon ${verb}" must not be parsed as a daemon run`,
      ).toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-014 — Supervisor port behavior over the injected tmux runner.
// ─────────────────────────────────────────────────────────────────────────────
describe('Supervisor port behavior (ADR-014)', () => {
  const REPO = '/tmp/acme/widgets';

  it('start is idempotent: no new-session when a session already exists (FR-2)', async () => {
    const mod = await load(TMUX_MOD);
    const makeSup = requireFn(mod, 'makeTmuxSupervisor');
    // has-session exit 0 ⇒ already up.
    const { run, calls } = spyRunner({ 'has-session': { code: 0 }, '-V': { code: 0 } });
    await makeSup(run).start(REPO);
    expect(argvOf(calls, 'has-session'), 'must probe for an existing session').toBeTruthy();
    expect(argvOf(calls, 'new-session'), 'must NOT create a second session').toBeUndefined();
  });

  it('start creates a detached foreground daemon session when none exists (FR-1)', async () => {
    const makeSup = requireFn(await load(TMUX_MOD), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ 'has-session': { code: 1 }, '-V': { code: 0 } });
    await makeSup(run).start(REPO);
    const newArgs = argvOf(calls, 'new-session');
    expect(newArgs, 'must create a session when none exists').toBeTruthy();
    expect(newArgs).toContain('-d'); // detached
    expect(newArgs!.join(' ')).toContain('conduct-ts daemon --continuous');
  });

  it('connect attaches READ-ONLY through the Supervisor port (FR-5)', async () => {
    // Drive the PORT, not the helper — a port that drops/ignores readOnly must fail here.
    const makeSup = requireFn(await load(TMUX_MOD), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ 'has-session': { code: 0 }, '-V': { code: 0 } });
    await makeSup(run).attach(REPO, { readOnly: true });
    const args = argvOf(calls, 'attach-session');
    expect(args, 'must attach the running session').toBeTruthy();
    expect(args).toContain('-r'); // read-only watch — cannot take control
    expect(calls.find((c) => c.args[0] === 'attach-session')!.inherit).toBe(true);
  });

  it('debug attaches read/write through the Supervisor port — never read-only (FR-6)', async () => {
    const makeSup = requireFn(await load(TMUX_MOD), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ 'has-session': { code: 0 }, '-V': { code: 0 } });
    await makeSup(run).attach(REPO, { readOnly: false });
    const args = argvOf(calls, 'attach-session');
    expect(args, 'must attach the running session').toBeTruthy();
    expect(args).not.toContain('-r'); // full interactive control
  });

  it('connect/debug on a NOT-running daemon errors with "start it first" (FR-9)', async () => {
    const makeSup = requireFn(await load(TMUX_MOD), 'makeTmuxSupervisor');
    const { run } = spyRunner({ 'has-session': { code: 1 }, '-V': { code: 0 } }); // absent
    await expect(makeSup(run).attach(REPO, { readOnly: true })).rejects.toThrow(/start/i);
  });

  it('a management action with tmux ABSENT fails with an actionable error (FR-8)', async () => {
    const mod = await load(TMUX_MOD);
    const makeSup = requireFn(mod, 'makeTmuxSupervisor');
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    const absent = () => {
      throw new NotInstalled();
    };
    await expect(makeSup(absent).start(REPO)).rejects.toThrow(/tmux/i);
  });

  it('isUp returns false (never throws) when tmux is ABSENT — bare-run safe (FR-14)', async () => {
    const mod = await load(TMUX_MOD);
    const makeSup = requireFn(mod, 'makeTmuxSupervisor');
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    const absent = () => {
      throw new NotInstalled();
    };
    // A read ("is it up?") must answer "no" on a tmux-less host, not throw — so it
    // can never crash a caller on the bare-run path.
    await expect(makeSup(absent).isUp(REPO)).resolves.toBe(false);
  });

  it('stop kills the session; restart kills then recreates', async () => {
    const makeSup = requireFn(await load(TMUX_MOD), 'makeTmuxSupervisor');
    const stop = spyRunner({ '-V': { code: 0 } });
    await makeSup(stop.run).stop(REPO);
    expect(argvOf(stop.calls, 'kill-session')).toBeTruthy();

    const restart = spyRunner({ '-V': { code: 0 } });
    await makeSup(restart.run).restart(REPO);
    const subs = restart.calls.map((c) => c.args[0]);
    expect(subs).toContain('kill-session');
    expect(subs).toContain('new-session');
    expect(subs.indexOf('kill-session')).toBeLessThan(subs.indexOf('new-session'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FR-11 — per-repo session isolation, even across same-basename repos.
// ─────────────────────────────────────────────────────────────────────────────
describe('Session isolation (FR-11)', () => {
  it('two repos sharing a basename get DISTINCT session names; same path is stable', async () => {
    const nameFor = requireFn(await load(TMUX_MOD), 'sessionNameForRepo');
    const a = nameFor('/home/alice/app');
    const b = nameFor('/home/bob/app');
    expect(a).not.toBe(b); // shared basename "app" must not collide
    expect(nameFor('/home/alice/app')).toBe(a); // stable per path
    expect(a.startsWith('cc-daemon-')).toBe(true);
    expect(a).not.toContain(':'); // tmux target separator must never appear
  });
});
