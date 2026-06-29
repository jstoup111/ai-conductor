import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Bare-run invariant (ADR-014, Condition C2 / FR-14).
//
// The daemon's BUILD path must run correctly with NO tmux present — tmux is purely
// the additive management/attach plane. This is enforced structurally: the daemon
// RUN loop (daemon-cli.ts) and its backlog discovery (daemon-backlog.ts) must NOT
// import the tmux layer (daemon-tmux.ts), so they cannot depend on tmux to function.
// (This is also the container/k8s entrypoint contract: one clean foreground process,
// no supervisor logic on the functional path.)
//
// A source-level import assertion is the cheap, robust guard: if the build path ever
// grows a tmux import, the daemon stops being bare-runnable and this test fails.
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, '..', '..', 'src');

async function importsTmux(relPath: string): Promise<boolean> {
  const source = await readFile(join(SRC, relPath), 'utf8');
  // Match an ESM import/re-export that pulls in the tmux adapter module.
  return /from\s+['"][^'"]*daemon-tmux(\.js)?['"]/.test(source);
}

describe('bare-run invariant: daemon build path is tmux-free (ADR-014 C2 / FR-14)', () => {
  it('the daemon run loop (daemon-cli.ts) does not import daemon-tmux', async () => {
    expect(await importsTmux('daemon-cli.ts')).toBe(false);
  });

  it('backlog discovery (daemon-backlog.ts) does not import daemon-tmux', async () => {
    expect(await importsTmux('engine/daemon-backlog.ts')).toBe(false);
  });

  it('the daemon RUN parser (detectDaemonCommand) needs no tmux — parses a run with tmux absent', async () => {
    const { detectDaemonCommand } = await import('../../src/engine/daemon-command.js');
    // A plain `daemon --continuous` run is parsed independently of any tmux probe.
    const cmd = detectDaemonCommand(['node', 'conduct-ts', 'daemon', '--continuous']);
    expect(cmd).not.toBeNull();
    expect(cmd!.continuous).toBe(true);
  });
});
