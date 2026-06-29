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
  it('calls capture-pane with -p and exact-match target', async () => {
    const capturePane = requireFn(await load(), 'capturePane');
    const { run, calls } = spyRunner({ 'capture-pane': { code: 0, stdout: 'some output\n' } });
    await capturePane('cc-daemon-myapp-abc123', run);
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['capture-pane', '-p', '-t', '=cc-daemon-myapp-abc123']);
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
    expect(calls[0].args).toEqual([
      'send-keys',
      '-t', '=cc-daemon-myapp-abc123',
      'conduct-ts status',
      'Enter',
    ]);
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
