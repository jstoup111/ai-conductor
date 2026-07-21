// ─────────────────────────────────────────────────────────────────────────────
// Task 3: startup dashboard's console output optionally shows PROCESSED
// (completed) features via DaemonModeOptions.showCompleted, while the
// persisted log sink NEVER includes PROCESSED regardless of the flag.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runDaemonMode, type DaemonModeOptions } from '../../src/daemon-cli.js';
import { daemonLogPath } from '../../src/engine/daemon-log.js';

let workDirs: string[] = [];

beforeEach(() => {
  workDirs = [];
});

afterEach(async () => {
  await Promise.all(workDirs.map((d) => rm(d, { recursive: true, force: true })));
});

async function freshDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), 'daemon-startup-completed-'));
  workDirs.push(d);
  return d;
}

async function seedProcessed(projectRoot: string, slug: string): Promise<void> {
  const dir = join(projectRoot, '.daemon', 'processed');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, slug), JSON.stringify({ prUrl: 'https://example.com/pr/1' }), 'utf-8');
}

function baseOpts(projectRoot: string, showCompleted?: boolean): DaemonModeOptions {
  return {
    projectRoot,
    concurrency: 1,
    baseBranch: 'main',
    ensureFresh: async () => {},
    workSource: { discover: async () => [] },
    showCompleted,
  };
}

describe('Task 3: startup dashboard PROCESSED gating (console vs persisted log)', () => {
  it('showCompleted: true — console shows PROCESSED, persisted log never does', async () => {
    const repo = await freshDir();
    await seedProcessed(repo, 'done-feature');

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(String(msg));
    try {
      await runDaemonMode(baseOpts(repo, true));
    } finally {
      console.log = origLog;
    }

    expect(lines.some((l) => l.includes('PROCESSED'))).toBe(true);

    const logContent = await readFile(daemonLogPath(repo), 'utf-8').catch(() => '');
    expect(logContent.includes('PROCESSED')).toBe(false);
  });

  it('showCompleted: true — console DOES write PROCESSED while the log sink stays clean of it (explicit split assertion)', async () => {
    const repo = await freshDir();
    await seedProcessed(repo, 'done-feature');

    const consoleLines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => consoleLines.push(String(msg));
    try {
      await runDaemonMode(baseOpts(repo, true));
    } finally {
      console.log = origLog;
    }

    // Positive: console output (rendered with { includeCompleted: true }) DOES
    // contain the PROCESSED group — proves the flag actually took effect on
    // the console render path, not merely that both sides omit it.
    const consoleOutput = consoleLines.join('\n');
    expect(consoleOutput).toContain('PROCESSED');
    expect(consoleOutput).toContain('done-feature');

    // Negative: the persisted log sink (rendered without opts, per Task 3's
    // split) NEVER contains PROCESSED, even though the console flag is set.
    const logContent = await readFile(daemonLogPath(repo), 'utf-8').catch(() => '');
    expect(logContent).not.toContain('PROCESSED');
  });

  it('showCompleted unset — neither console nor persisted log shows PROCESSED', async () => {
    const repo = await freshDir();
    await seedProcessed(repo, 'done-feature');

    const lines: string[] = [];
    const origLog = console.log;
    console.log = (msg: string) => lines.push(String(msg));
    try {
      await runDaemonMode(baseOpts(repo, undefined));
    } finally {
      console.log = origLog;
    }

    expect(lines.some((l) => l.includes('PROCESSED'))).toBe(false);

    const logContent = await readFile(daemonLogPath(repo), 'utf-8').catch(() => '');
    expect(logContent.includes('PROCESSED')).toBe(false);
  });
});
