import { describe, it, expect } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// RED unit specs for the NOT-YET-BUILT module `src/engine/daemon-tmux.ts`
// (ADR-014, PR #143).
//
// These are GRANULAR per-helper argv specs — one focused assertion per helper.
// High-level Supervisor behavior (routing, idempotent start, isolation at the
// Supervisor port level) is covered by the acceptance suite in
// test/acceptance/daemon-supervised-hosting.test.ts; do NOT duplicate those.
//
// Convention: each test dynamically imports the symbol under test INSIDE its
// own body so that a missing export surfaces as THAT test's RED failure, not
// a whole-file collection crash that would mask which helper is unimplemented.
//
// Contract (ADR-014 spec — no implementation exists yet):
//   TmuxRunner = (args: string[], opts: {inherit: boolean}) => {code: number; stdout: string}
//   sessionNameForRepo(repoPath)           → 'cc-daemon-<slug>-<6hexhash>'
//   hasSession(name, run)                  → runs ['has-session','-t','=<name>'], inherit:false
//   newDetachedSession(name,cmd,cwd,run)   → runs ['new-session','-d','-s',name,'-c',cwd,cmd]
//   killSession(name, run)                 → runs ['kill-session','-t','=<name>']; no-op on non-zero
//   attachSession(name,{readOnly},run)     → runs ['attach-session','-t','=<name>'](+'-r' if RO), inherit:true
//   capturePane(name, run)                 → runs ['capture-pane','-p','-t','=<name>']; returns stdout
//   sendKeys(name,command,run)             → runs ['send-keys','-t','=<name>',command,'Enter']
//   tmuxInstalled(run)                     → runs ['-V']; false (not throw) when runner throws TmuxNotInstalledError
//   requireTmux(run)                       → throws TmuxNotInstalledError when not installed
//   TmuxNotInstalledError                  → exported Error subclass; message mentions 'tmux'
// ─────────────────────────────────────────────────────────────────────────────

const TMUX_MOD = '../../src/engine/daemon-tmux.js';

async function load(): Promise<Record<string, unknown>> {
  // Throws (RED) when the module does not exist yet — the intended pre-impl failure.
  return (await import(TMUX_MOD)) as Record<string, unknown>;
}

function requireFn(mod: Record<string, unknown>, name: string): (...args: any[]) => any {
  const fn = mod[name];
  if (typeof fn !== 'function') {
    throw new Error(`expected export "${name}" to be a function (not yet implemented)`);
  }
  return fn as (...args: any[]) => any;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spy runner factory — records every (args, inherit) pair the helper emits.
// ─────────────────────────────────────────────────────────────────────────────
type Call = { args: string[]; inherit: boolean };

function spyRunner(
  overrides: Record<string, { code: number; stdout?: string }> = {},
): { run: (args: string[], opts: { inherit: boolean }) => { code: number; stdout: string }; calls: Call[] } {
  const calls: Call[] = [];
  const run = (args: string[], opts: { inherit: boolean }) => {
    calls.push({ args, inherit: opts.inherit });
    const r = overrides[args[0]] ?? { code: 0, stdout: '' };
    return { code: r.code, stdout: r.stdout ?? '' };
  };
  return { run, calls };
}

// ─────────────────────────────────────────────────────────────────────────────
// sessionNameForRepo — slug, hash, format, safety chars, stability
// ─────────────────────────────────────────────────────────────────────────────
describe('sessionNameForRepo: format, stability, and safety chars', () => {
  it('returns a name prefixed with cc-daemon-', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    expect(nameFor('/home/alice/myapp')).toMatch(/^cc-daemon-/);
  });

  it('slug is the lowercased basename of the repo path', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    const name: string = nameFor('/home/alice/MyApp');
    // cc-daemon-<slug>-<hash>; slug immediately follows the prefix
    const slug = name.replace(/^cc-daemon-/, '').replace(/-[0-9a-f]{6}$/, '');
    expect(slug).toBe('myapp');
  });

  it('name never contains ":" (tmux target separator)', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    expect(nameFor('/some/path/to/my.app')).not.toContain(':');
  });

  it('name never contains "." (tmux window separator)', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    expect(nameFor('/some/path/to/my.app')).not.toContain('.');
  });

  it('same absolute path always produces the same name (stable)', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    const path = '/home/alice/widgets';
    expect(nameFor(path)).toBe(nameFor(path));
  });

  it('different absolute paths that share a basename produce distinct names', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    const a = nameFor('/home/alice/app');
    const b = nameFor('/home/bob/app');
    expect(a).not.toBe(b);
  });

  it('name ends with a 6-char lowercase hex hash', async () => {
    const nameFor = requireFn(await load(), 'sessionNameForRepo');
    const name: string = nameFor('/home/alice/widgets');
    expect(name).toMatch(/-[0-9a-f]{6}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasSession — exact argv; inherit:false
// ─────────────────────────────────────────────────────────────────────────────
describe('hasSession: argv and inherit flag', () => {
  it('calls has-session with exact-match target prefix "=" and inherit:false', async () => {
    const hasSession = requireFn(await load(), 'hasSession');
    const { run, calls } = spyRunner({ 'has-session': { code: 0 } });
    await hasSession('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['has-session', '-t', '=cc-daemon-myapp-abc123']);
    expect(calls[0].inherit).toBe(false);
  });

  it('returns true when tmux exits 0 (session exists)', async () => {
    const hasSession = requireFn(await load(), 'hasSession');
    const { run } = spyRunner({ 'has-session': { code: 0 } });
    expect(await hasSession('cc-daemon-myapp-abc123', run)).toBe(true);
  });

  it('returns false when tmux exits non-zero (session absent)', async () => {
    const hasSession = requireFn(await load(), 'hasSession');
    const { run } = spyRunner({ 'has-session': { code: 1 } });
    expect(await hasSession('cc-daemon-myapp-abc123', run)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// newDetachedSession — exact argv
// ─────────────────────────────────────────────────────────────────────────────
describe('newDetachedSession: argv', () => {
  it('calls new-session with -d, -s <name>, -c <cwd>, <command>', async () => {
    const newDetachedSession = requireFn(await load(), 'newDetachedSession');
    const { run, calls } = spyRunner();
    await newDetachedSession('cc-daemon-widget-ff0011', 'conduct-ts daemon --continuous', '/repo/widget', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'new-session',
      '-d',
      '-s', 'cc-daemon-widget-ff0011',
      '-c', '/repo/widget',
      'conduct-ts daemon --continuous',
    ]);
  });

  it('throws when tmux exits non-zero', async () => {
    const newDetachedSession = requireFn(await load(), 'newDetachedSession');
    const { run } = spyRunner({ 'new-session': { code: 1 } });
    await expect(newDetachedSession('cc-daemon-widget-ff0011', 'conduct-ts daemon --continuous', '/repo/widget', run))
      .rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// killSession — exact argv; no-throw on non-zero (absent session is a no-op)
// ─────────────────────────────────────────────────────────────────────────────
describe('killSession: argv and no-throw on non-zero', () => {
  it('calls kill-session with exact-match target prefix "="', async () => {
    const killSession = requireFn(await load(), 'killSession');
    const { run, calls } = spyRunner();
    await killSession('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['kill-session', '-t', '=cc-daemon-myapp-abc123']);
  });

  it('does NOT throw when session is absent (non-zero exit)', async () => {
    const killSession = requireFn(await load(), 'killSession');
    const { run } = spyRunner({ 'kill-session': { code: 1 } });
    await expect(killSession('cc-daemon-myapp-abc123', run)).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// attachSession — exact argv; "-r" only when readOnly; inherit:true
// ─────────────────────────────────────────────────────────────────────────────
describe('attachSession: argv, -r flag, and inherit:true', () => {
  it('calls attach-session with exact-match "-t =<name>" and inherit:true (readOnly:false)', async () => {
    const attachSession = requireFn(await load(), 'attachSession');
    const { run, calls } = spyRunner();
    await attachSession('cc-daemon-myapp-abc123', { readOnly: false }, run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toContain('attach-session');
    expect(calls[0].args).toContain('-t');
    expect(calls[0].args).toContain('=cc-daemon-myapp-abc123');
    expect(calls[0].args).not.toContain('-r');
    expect(calls[0].inherit).toBe(true);
  });

  it('appends "-r" when readOnly:true', async () => {
    const attachSession = requireFn(await load(), 'attachSession');
    const { run, calls } = spyRunner();
    await attachSession('cc-daemon-myapp-abc123', { readOnly: true }, run);
    expect(calls[0].args).toContain('-r');
    expect(calls[0].inherit).toBe(true);
  });

  it('exact argv for readOnly:true is ["attach-session","-t","=<name>","-r"]', async () => {
    const attachSession = requireFn(await load(), 'attachSession');
    const { run, calls } = spyRunner();
    await attachSession('cc-daemon-myapp-abc123', { readOnly: true }, run);
    expect(calls[0].args).toEqual(['attach-session', '-t', '=cc-daemon-myapp-abc123', '-r']);
  });

  it('exact argv for readOnly:false is ["attach-session","-t","=<name>"]', async () => {
    const attachSession = requireFn(await load(), 'attachSession');
    const { run, calls } = spyRunner();
    await attachSession('cc-daemon-myapp-abc123', { readOnly: false }, run);
    expect(calls[0].args).toEqual(['attach-session', '-t', '=cc-daemon-myapp-abc123']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// capturePane — exact argv; returns stdout on exit 0; empty string on non-zero
// ─────────────────────────────────────────────────────────────────────────────
describe('capturePane: argv and stdout return', () => {
  it('calls capture-pane with -p and the exact-session active-PANE target (=name:)', async () => {
    const capturePane = requireFn(await load(), 'capturePane');
    const { run, calls } = spyRunner({ 'capture-pane': { code: 0, stdout: 'some output\n' } });
    await capturePane('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    // Pane verbs need `=<session>:` — a bare `=<session>` is rejected by real tmux
    // capture-pane ("can't find pane"). The trailing ':' targets the active pane.
    expect(calls[0].args).toEqual(['capture-pane', '-p', '-t', '=cc-daemon-myapp-abc123:']);
  });

  it('returns stdout when exit code is 0', async () => {
    const capturePane = requireFn(await load(), 'capturePane');
    const { run } = spyRunner({ 'capture-pane': { code: 0, stdout: 'build log line\n' } });
    const result = await capturePane('cc-daemon-myapp-abc123', run);
    expect(result).toBe('build log line\n');
  });

  it('returns empty string when exit code is non-zero (no throw)', async () => {
    const capturePane = requireFn(await load(), 'capturePane');
    const { run } = spyRunner({ 'capture-pane': { code: 1, stdout: 'irrelevant' } });
    const result = await capturePane('cc-daemon-myapp-abc123', run);
    expect(result).toBe('');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sendKeys — exact argv
// ─────────────────────────────────────────────────────────────────────────────
describe('sendKeys: argv', () => {
  it('calls send-keys with exact-match target, the command text, and "Enter"', async () => {
    const sendKeys = requireFn(await load(), 'sendKeys');
    const { run, calls } = spyRunner();
    await sendKeys('cc-daemon-myapp-abc123', 'conduct-ts status', run);
    expect(calls).toHaveLength(1);
    // Pane-targeting verb: `=<session>:` (active pane), not the bare session target.
    expect(calls[0].args).toEqual([
      'send-keys',
      '-t', '=cc-daemon-myapp-abc123:',
      'conduct-ts status',
      'Enter',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setRemainOnExit — exact argv; session-scoped target
// ─────────────────────────────────────────────────────────────────────────────
describe('setRemainOnExit: argv', () => {
  it('calls set-option with exact-match session target and remain-on-exit on', async () => {
    const setRemainOnExit = requireFn(await load(), 'setRemainOnExit');
    const { run, calls } = spyRunner();
    await setRemainOnExit('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'set-option', '-t', '=cc-daemon-myapp-abc123', 'remain-on-exit', 'on',
    ]);
    expect(calls[0].inherit).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// respawnPane — exact argv; window/pane-scoped target; throws on non-zero
// ─────────────────────────────────────────────────────────────────────────────
describe('respawnPane: argv and error handling', () => {
  it('calls respawn-pane -k with the exact-match window/pane target (=name:0.0)', async () => {
    const respawnPane = requireFn(await load(), 'respawnPane');
    const { run, calls } = spyRunner();
    await respawnPane('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['respawn-pane', '-k', '-t', '=cc-daemon-myapp-abc123:0.0']);
    expect(calls[0].inherit).toBe(false);
  });

  it('throws when tmux exits non-zero', async () => {
    const respawnPane = requireFn(await load(), 'respawnPane');
    const { run } = spyRunner({ 'respawn-pane': { code: 1 } });
    await expect(respawnPane('cc-daemon-myapp-abc123', run)).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isPaneDead — exact argv; distinguishes session-up from process-alive (FR-12)
// ─────────────────────────────────────────────────────────────────────────────
describe('isPaneDead: argv and liveness detection', () => {
  it('calls list-panes with the exact-match pane target and #{pane_dead} format', async () => {
    const isPaneDead = requireFn(await load(), 'isPaneDead');
    const { run, calls } = spyRunner({ 'list-panes': { code: 0, stdout: '0\n' } });
    await isPaneDead('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual([
      'list-panes',
      '-t',
      '=cc-daemon-myapp-abc123:0.0',
      '-F',
      '#{pane_dead}',
    ]);
    expect(calls[0].inherit).toBe(false);
  });

  it('returns true when tmux reports pane_dead=1', async () => {
    const isPaneDead = requireFn(await load(), 'isPaneDead');
    const { run } = spyRunner({ 'list-panes': { code: 0, stdout: '1\n' } });
    await expect(isPaneDead('cc-daemon-myapp-abc123', run)).resolves.toBe(true);
  });

  it('returns false when tmux reports pane_dead=0', async () => {
    const isPaneDead = requireFn(await load(), 'isPaneDead');
    const { run } = spyRunner({ 'list-panes': { code: 0, stdout: '0\n' } });
    await expect(isPaneDead('cc-daemon-myapp-abc123', run)).resolves.toBe(false);
  });

  it('returns false (never throws) when list-panes exits non-zero', async () => {
    const isPaneDead = requireFn(await load(), 'isPaneDead');
    const { run } = spyRunner({ 'list-panes': { code: 1 } });
    await expect(isPaneDead('cc-daemon-myapp-abc123', run)).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeTmuxSupervisor().start — dead-pane revival (FR-12, Task 23)
// ─────────────────────────────────────────────────────────────────────────────
describe('makeTmuxSupervisor().start: dead-pane revival', () => {
  it('session up + pane dead → respawns in place (not new-session, not no-op)', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({
      '-V': { code: 0 },
      'has-session': { code: 0 },
      'list-panes': { code: 0, stdout: '1\n' },
    });
    await makeTmuxSupervisor(run).start('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).toContain('respawn-pane');
    expect(subs).toContain('set-option');
    expect(subs).not.toContain('new-session');
    expect(subs).not.toContain('kill-session');
  });

  it('session up + pane alive → no-op (idempotent, no respawn or new-session)', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({
      '-V': { code: 0 },
      'has-session': { code: 0 },
      'list-panes': { code: 0, stdout: '0\n' },
    });
    await makeTmuxSupervisor(run).start('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).not.toContain('respawn-pane');
    expect(subs).not.toContain('new-session');
  });

  it('session absent → new-session (existing behavior, no pane liveness probe needed)', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({
      '-V': { code: 0 },
      'has-session': { code: 1 },
    });
    await makeTmuxSupervisor(run).start('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).toContain('new-session');
    expect(subs).not.toContain('respawn-pane');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeTmuxSupervisor().isUp — distinguishes session-up from process-alive (FR-12)
// ─────────────────────────────────────────────────────────────────────────────
describe('makeTmuxSupervisor().isUp: session-up vs process-alive', () => {
  it('returns true when session exists and pane is alive', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run } = spyRunner({
      'has-session': { code: 0 },
      'list-panes': { code: 0, stdout: '0\n' },
    });
    await expect(makeTmuxSupervisor(run).isUp('/home/alice/myapp')).resolves.toBe(true);
  });

  it('returns false when session exists but pane is dead', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run } = spyRunner({
      'has-session': { code: 0 },
      'list-panes': { code: 0, stdout: '1\n' },
    });
    await expect(makeTmuxSupervisor(run).isUp('/home/alice/myapp')).resolves.toBe(false);
  });

  it('returns false when session is absent', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run } = spyRunner({ 'has-session': { code: 1 } });
    await expect(makeTmuxSupervisor(run).isUp('/home/alice/myapp')).resolves.toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeTmuxSupervisor().restart — respawn-in-place (ADR-014, FR-20)
// ─────────────────────────────────────────────────────────────────────────────
describe('makeTmuxSupervisor().restart: respawn-in-place', () => {
  it('sets remain-on-exit then respawn-panes the daemon pane; NO kill-session', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 } });
    await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).toContain('set-option');
    expect(subs).toContain('respawn-pane');
    expect(subs).not.toContain('kill-session');
    expect(subs).not.toContain('new-session');
  });

  it('set-option precedes respawn-pane', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 } });
    await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs.indexOf('set-option')).toBeLessThan(subs.indexOf('respawn-pane'));
  });

  it('addresses only the daemon pane (window 0 / pane 0) — no argv targets any other window', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 } });
    await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const respawnCall = calls.find((c) => c.args[0] === 'respawn-pane')!;
    expect(respawnCall.args).toEqual(
      expect.arrayContaining(['-t', expect.stringMatching(/^=cc-daemon-myapp-[0-9a-f]{6}:0\.0$/)]),
    );
    // No call in the whole restart flow ever addresses a window/pane index other
    // than 0.0 — i.e. no argv element matches ":<n>." for n != 0 or ":0.<n>" for n != 0.
    for (const call of calls) {
      for (const arg of call.args) {
        if (typeof arg === 'string' && arg.includes(':')) {
          expect(arg).toMatch(/:0\.0$|:$|^=[^:]+$/);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// makeTmuxSupervisor().restart — respawn fallback on failure (FR-20 neg, Task 24)
//
// When the tmux tooling cannot respawn the daemon pane in place (respawn-pane
// exits non-zero), restart() falls back to kill-session + new-session so the
// daemon still ends up running — but this loses tmux scrollback/session
// continuity, so the outcome must say so explicitly. The fallback must NEVER
// fire when respawn-pane succeeds.
// ─────────────────────────────────────────────────────────────────────────────
describe('makeTmuxSupervisor().restart: respawn fallback on failure (FR-20 neg)', () => {
  it('falls back to kill-session + new-session when respawn-pane fails', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 }, 'respawn-pane': { code: 1 } });
    await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).toContain('respawn-pane');
    expect(subs).toContain('kill-session');
    expect(subs).toContain('new-session');
  });

  it('reports session-continuity loss in the outcome when the fallback is taken', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run } = spyRunner({ '-V': { code: 0 }, 'respawn-pane': { code: 1 } });
    const outcome = await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    expect(outcome).toBeDefined();
    expect(outcome!.degraded).toBe(true);
    expect(outcome!.message.toLowerCase()).toMatch(
      /session.*(continuity|history|scrollback).*lost|lost.*session.*(continuity|history|scrollback)/,
    );
  });

  it('does NOT take the fallback when respawn-pane succeeds', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 } });
    const outcome = await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const subs = calls.map((c) => c.args[0]);
    expect(subs).not.toContain('kill-session');
    expect(subs).not.toContain('new-session');
    expect(outcome?.degraded ?? false).toBe(false);
  });

  it('the recreated session after fallback uses the same session name and foreground command', async () => {
    const makeTmuxSupervisor = requireFn(await load(), 'makeTmuxSupervisor');
    const { run, calls } = spyRunner({ '-V': { code: 0 }, 'respawn-pane': { code: 1 } });
    await makeTmuxSupervisor(run).restart('/home/alice/myapp');
    const killCall = calls.find((c) => c.args[0] === 'kill-session')!;
    const newCall = calls.find((c) => c.args[0] === 'new-session')!;
    expect(killCall.args).toEqual(
      expect.arrayContaining([expect.stringMatching(/^=cc-daemon-myapp-[0-9a-f]{6}$/)]),
    );
    expect(newCall.args).toContain('conduct-ts daemon --continuous');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// tmuxInstalled — calls [-V]; true/false; false (not throw) on TmuxNotInstalledError
// ─────────────────────────────────────────────────────────────────────────────
describe('tmuxInstalled: argv, boolean return, and throwing-runner false path', () => {
  it('calls tmux with ["-V"] to probe for the binary', async () => {
    const tmuxInstalled = requireFn(await load(), 'tmuxInstalled');
    const { run, calls } = spyRunner({ '-V': { code: 0 } });
    await tmuxInstalled(run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['-V']);
  });

  it('returns true when tmux -V exits 0', async () => {
    const tmuxInstalled = requireFn(await load(), 'tmuxInstalled');
    const { run } = spyRunner({ '-V': { code: 0 } });
    expect(await tmuxInstalled(run)).toBe(true);
  });

  it('returns false when tmux -V exits non-zero', async () => {
    const tmuxInstalled = requireFn(await load(), 'tmuxInstalled');
    const { run } = spyRunner({ '-V': { code: 1 } });
    expect(await tmuxInstalled(run)).toBe(false);
  });

  it('returns false (does NOT throw) when the runner throws TmuxNotInstalledError', async () => {
    const mod = await load();
    const tmuxInstalled = requireFn(mod, 'tmuxInstalled');
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    if (typeof NotInstalled !== 'function') {
      throw new Error('expected export "TmuxNotInstalledError" to be a class (not yet implemented)');
    }
    const absent = (_args: string[], _opts: { inherit: boolean }): { code: number; stdout: string } => {
      throw new NotInstalled();
    };
    expect(await tmuxInstalled(absent)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requireTmux — throws TmuxNotInstalledError when not installed
// ─────────────────────────────────────────────────────────────────────────────
describe('requireTmux: throws TmuxNotInstalledError when tmux is absent', () => {
  it('throws when tmux -V exits non-zero', async () => {
    const requireTmux = requireFn(await load(), 'requireTmux');
    const { run } = spyRunner({ '-V': { code: 1 } });
    await expect(requireTmux(run)).rejects.toThrow(/tmux/i);
  });

  it('throws an instance of TmuxNotInstalledError specifically', async () => {
    const mod = await load();
    const requireTmux = requireFn(mod, 'requireTmux');
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    if (typeof NotInstalled !== 'function') {
      throw new Error('expected export "TmuxNotInstalledError" to be a class (not yet implemented)');
    }
    const { run } = spyRunner({ '-V': { code: 1 } });
    await expect(requireTmux(run)).rejects.toBeInstanceOf(NotInstalled);
  });

  it('resolves without throwing when tmux is present', async () => {
    const requireTmux = requireFn(await load(), 'requireTmux');
    const { run } = spyRunner({ '-V': { code: 0 } });
    await expect(requireTmux(run)).resolves.not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TmuxNotInstalledError — exported Error subclass; message mentions 'tmux'
// ─────────────────────────────────────────────────────────────────────────────
describe('TmuxNotInstalledError: exported Error subclass with tmux message', () => {
  it('is an exported class', async () => {
    const mod = await load();
    const NotInstalled = mod.TmuxNotInstalledError;
    if (typeof NotInstalled !== 'function') {
      throw new Error('expected export "TmuxNotInstalledError" to be a class (not yet implemented)');
    }
    expect(typeof NotInstalled).toBe('function');
  });

  it('instances are instanceof Error', async () => {
    const mod = await load();
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    if (typeof NotInstalled !== 'function') {
      throw new Error('expected export "TmuxNotInstalledError" to be a class (not yet implemented)');
    }
    expect(new NotInstalled()).toBeInstanceOf(Error);
  });

  it('message mentions "tmux"', async () => {
    const mod = await load();
    const NotInstalled = mod.TmuxNotInstalledError as new () => Error;
    if (typeof NotInstalled !== 'function') {
      throw new Error('expected export "TmuxNotInstalledError" to be a class (not yet implemented)');
    }
    expect(new NotInstalled().message).toMatch(/tmux/i);
  });
});
