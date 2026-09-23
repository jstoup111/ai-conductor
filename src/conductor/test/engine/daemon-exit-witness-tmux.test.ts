// Covers: task:9
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDaemonExitWitnessCommand,
  makeTmuxSupervisor,
  type TmuxRunner,
} from '../../src/engine/daemon-tmux.js';

const sockets: Array<{ root: string; run: TmuxRunner }> = [];

afterEach(async () => {
  await Promise.all(sockets.splice(0).map(async ({ run, root }) => {
    run(['kill-server'], { inherit: false });
    await rm(root, { recursive: true, force: true });
  }));
});

function privateTmux(socket: string): TmuxRunner {
  return (args, opts) => {
    const result = spawnSync('tmux', ['-L', socket, ...args], {
      encoding: 'utf8',
      stdio: opts.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    });
    return {
      code: result.status ?? 1,
      stdout: (result.stdout as string | null) ?? '',
      stderr: (result.stderr as string | null) ?? '',
    };
  };
}

describe('daemon pane exit-witness wrapper', () => {
  it('keeps the daemon child pid and status paired for the witness', () => {
    const command = buildDaemonExitWitnessCommand('exit 3');

    expect(command).toContain('exit 3 & pid=$!; wait "$pid"; rc=$?;');
    expect(command).toContain('daemon exit-witness --pid "$pid" --status "$rc"');
    expect(command).toContain('exit "$rc"');
  });

  it('writes the exited child record before a private-socket pane becomes dead', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'daemon-exit-witness-tmux-'));
    const repo = join(root, 'repo');
    const socket = 'exit-witness-' + process.pid + '-' + Date.now();
    const run = privateTmux(socket);
    sockets.push({ root, run });
    await mkdir(repo);
    const launcher = join(root, 'source-launcher.sh');
    await writeFile(
      launcher,
      '#!/bin/sh\n' +
        'if [ "$1" = daemon ] && [ "$2" = exit-witness ]; then\n' +
        '  mkdir -p .daemon\n' +
        '  printf \'{\"type\":\"daemon_exited\",\"pid\":%s,\"code\":%s,\"signal\":null}\\n\' "$4" "$6" > .daemon/exit-events.jsonl\n' +
        'fi\n',
      'utf8',
    );
    await chmod(launcher, 0o755);
    const priorLauncher = process.env.AI_CONDUCTOR_ENGINE_BIN;
    process.env.AI_CONDUCTOR_ENGINE_BIN = launcher;
    try {
      const supervisor = makeTmuxSupervisor(run);
      await supervisor.start(repo, 'sh -c "sleep 0.2; exit 3"');

      let record: { pid: number; code: number | null; signal: string | null } | undefined;
      for (let attempt = 0; attempt < 40 && record === undefined; attempt += 1) {
        try {
          record = JSON.parse((await readFile(join(repo, '.daemon', 'exit-events.jsonl'), 'utf8')).trim());
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }

      if (!record) throw new Error(await supervisor.logs(repo));
      expect(record).toMatchObject({ type: 'daemon_exited', code: 3, signal: null });
      expect(record?.pid).toEqual(expect.any(Number));
      expect(await supervisor.isUp(repo)).toBe(false);
    } finally {
      if (priorLauncher === undefined) delete process.env.AI_CONDUCTOR_ENGINE_BIN;
      else process.env.AI_CONDUCTOR_ENGINE_BIN = priorLauncher;
    }
  });
});
