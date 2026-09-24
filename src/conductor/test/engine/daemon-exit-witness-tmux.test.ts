// Covers: task:7, task:9
import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { access, chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildDaemonExitWitnessCommand,
  makeTmuxSupervisor,
  newDetachedSession,
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

async function eventually<T>(read: () => Promise<T>): Promise<T> {
  let error: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { return await read(); } catch (caught) { error = caught; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw error;
}

async function fixture(): Promise<{ repo: string; run: TmuxRunner; restore: () => void }> {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'daemon-exit-witness-tmux-'));
  const repo = join(root, 'repo');
  const socket = `exit-witness-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const run = privateTmux(socket);
  sockets.push({ root, run });
  await mkdir(join(repo, '.daemon'), { recursive: true });
  const launcher = join(root, 'source-launcher.sh');
  const witness = join(root, 'witness-launcher.ts');
  await writeFile(
    witness,
    `import { runExitWitness } from ${JSON.stringify(join(process.cwd(), 'src', 'engine', 'daemon-exit-witness.ts'))};\n` +
      'const args = process.argv.slice(2);\n' +
      "if (args[0] === 'daemon' && args[1] === 'exit-witness') {\n" +
      "  const value = (flag: string) => args[args.indexOf(flag) + 1]!;\n" +
      "  process.exitCode = runExitWitness({ root: process.cwd(), pid: Number(value('--pid')), status: Number(value('--status')) });\n" +
      '}\n',
    'utf8',
  );
  await writeFile(launcher, `#!/bin/sh\nexec node --import tsx ${witness} "$@"\n`, 'utf8');
  await chmod(launcher, 0o755);
  const priorLauncher = process.env.AI_CONDUCTOR_ENGINE_BIN;
  process.env.AI_CONDUCTOR_ENGINE_BIN = launcher;
  return {
    repo,
    run,
    restore: () => {
      if (priorLauncher === undefined) delete process.env.AI_CONDUCTOR_ENGINE_BIN;
      else process.env.AI_CONDUCTOR_ENGINE_BIN = priorLauncher;
    },
  };
}

async function exitRecords(repo: string): Promise<Array<{ pid: number; code: number | null; signal: string | null }>> {
  return (await readFile(join(repo, '.daemon', 'exit-events.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

describe('daemon pane exit-witness wrapper', () => {
  it('keeps the daemon child pid and status paired for the witness and redirects stderr to the repo log', () => {
    const command = buildDaemonExitWitnessCommand('exit 3', '/repo');

    expect(command).toMatch(/exit 3 2>>.*\/repo\/\.daemon\/daemon\.log.* & pid=\$!; wait "\$pid"; rc=\$\?;/);
    expect(command).toContain('daemon exit-witness --pid "$pid" --status "$rc"');
    expect(command).toContain('exit "$rc"');
  });

  for (const [label, command, expected] of [
    ['exit 0', 'exit 0', { code: 0, signal: null }],
    ['exit 3', 'exit 3', { code: 3, signal: null }],
  ] as const) {
    it(`writes exactly one ${label} record through the real witness before the pane exits`, async () => {
      const test = await fixture();
      try {
        const supervisor = makeTmuxSupervisor(test.run);
        await supervisor.start(test.repo, command);
        const records = await eventually(() => exitRecords(test.repo));

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ type: 'daemon_exited', ...expected, pid: expect.any(Number) });
        expect(await supervisor.isUp(test.repo)).toBe(false);
      } finally { test.restore(); }
    });
  }

  it('records a SIGKILL without touching the event spine and keeps the pane present', async () => {
    const test = await fixture();
    try {
      const supervisor = makeTmuxSupervisor(test.run);
      await supervisor.start(test.repo, 'exec sh -c "echo \\$\\$ > child.pid; exec sleep 30"');
      const pid = Number((await eventually(() => readFile(join(test.repo, 'child.pid'), 'utf8'))).trim());
      process.kill(pid, 'SIGKILL');
      const records = await eventually(() => exitRecords(test.repo));

      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ type: 'daemon_exited', pid, code: null, signal: 'SIGKILL' });
      await expect(access(join(test.repo, '.daemon', 'events.jsonl'))).rejects.toThrow();
      expect(await supervisor.hasSession(test.repo)).toBe(true);
    } finally { test.restore(); }
  });

  it('captures a 16 MB heap abort in daemon.log and witnesses its non-zero exit', async () => {
    const test = await fixture();
    try {
      const supervisor = makeTmuxSupervisor(test.run);
      await supervisor.start(test.repo, "NODE_OPTIONS=--max-old-space-size=16 node -e 'const a=[]; while (true) a.push(new Array(1e6).fill(1))'");
      const records = await eventually(() => exitRecords(test.repo));
      const log = await eventually(() => readFile(join(test.repo, '.daemon', 'daemon.log'), 'utf8'));

      expect(log).toContain('JavaScript heap out of memory');
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        type: 'daemon_exited',
        pid: expect.any(Number),
        code: 134,
        signal: 'SIGABRT',
        at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    } finally { test.restore(); }
  });

  it('writes one parseable witness line per concurrently exiting wrapper pid', async () => {
    const test = await fixture();
    try {
      const command = buildDaemonExitWitnessCommand('sh -c "sleep 0.1; exit 3"', test.repo);
      await Promise.all([
        newDetachedSession('cc-daemon-witness-overlap-a', command, test.repo, test.run),
        newDetachedSession('cc-daemon-witness-overlap-b', command, test.repo, test.run),
      ]);
      const records = await eventually(async () => {
        const found = await exitRecords(test.repo);
        if (found.length !== 2) throw new Error('waiting for both exit records');
        return found;
      });

      expect(new Set(records.map((record) => record.pid)).size).toBe(2);
      expect(records.every((record) => record.code === 3 && record.signal === null)).toBe(true);
    } finally { test.restore(); }
  });

  it('leaves no exit ledger for a bare daemon command without the wrapper', async () => {
    const test = await fixture();
    try {
      await newDetachedSession('cc-daemon-witness-bare', 'exit 0', test.repo, test.run);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await expect(access(join(test.repo, '.daemon', 'exit-events.jsonl'))).rejects.toThrow();
    } finally { test.restore(); }
  });
});
