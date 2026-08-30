// Unit coverage for the `ai-conductor --version` report: argv grammar,
// harness-VERSION resolution, rendering, and the dispatch that prints it.
//
// Level: unit. Every boundary the report touches (the VERSION file read and
// the output sink) is injected, so nothing here reads the real filesystem or
// spawns a process.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  detectVersionCommand,
  harnessVersionCandidates,
  renderVersionReport,
  resolveHarnessVersion,
  dispatchVersionCommand,
} from '../../src/engine/version-report.js';
import { createProgram } from '../../src/cli.js';

describe('detectVersionCommand', () => {
  it('detects the three spellings of a bare version request', () => {
    for (const token of ['--version', '-V', 'version']) {
      expect(detectVersionCommand(['node', 'ai-conductor', token])).toEqual({ kind: 'version' });
    }
  });

  it('ignores a version token that is not the whole invocation', () => {
    expect(detectVersionCommand(['node', 'ai-conductor'])).toBeNull();
    expect(detectVersionCommand(['node', 'ai-conductor', 'daemon', '--version'])).toBeNull();
    expect(detectVersionCommand(['node', 'ai-conductor', 'version', '--json'])).toBeNull();
    expect(detectVersionCommand(['node', 'ai-conductor', '--versions'])).toBeNull();
  });
});

describe('resolveHarnessVersion', () => {
  // The CLI is reached through a symlink chain (~/.local/bin/ai-conductor →
  // <harness>/bin/ai-conductor → the pinned dist), so the VERSION probe must be
  // relative to the running module, never to the caller's cwd.
  it('probes both the bundle depth and the source-tree depth, module-relative', () => {
    expect(harnessVersionCandidates('/h/src/conductor/dist-versions/20260830T171713Z-1b6d3c88ea5a')).toEqual([
      join('/h/src/conductor/dist-versions/20260830T171713Z-1b6d3c88ea5a', '..', '..', '..', 'VERSION'),
      join('/h/src/conductor/dist-versions/20260830T171713Z-1b6d3c88ea5a', '..', '..', '..', '..', 'VERSION'),
    ]);
  });

  it('returns the first candidate that holds a semver-shaped VERSION', async () => {
    const reads: string[] = [];
    const version = await resolveHarnessVersion('/h/src/conductor/dist-versions/v', async (p) => {
      reads.push(p);
      return p === join('/h', 'VERSION') ? '0.104.0\n' : null;
    });
    expect(version).toBe('0.104.0');
    // Nearest candidate first: the source-tree depth is probed before the
    // bundle depth, and only the bundle depth resolves here.
    expect(reads).toEqual([join('/h', 'src', 'VERSION'), join('/h', 'VERSION')]);
  });

  it('falls back to 0.0.0 when no candidate holds a semver VERSION', async () => {
    expect(await resolveHarnessVersion('/h/x', async () => null)).toBe('0.0.0');
    expect(await resolveHarnessVersion('/h/x', async () => 'not a version')).toBe('0.0.0');
  });
});

describe('renderVersionReport', () => {
  it('names the harness version and the pinned engine build', () => {
    expect(
      renderVersionReport({ harnessVersion: '0.104.0', engineVersion: '20260830T171713Z-1b6d3c88ea5a' }),
    ).toBe('ai-conductor 0.104.0 (engine 20260830T171713Z-1b6d3c88ea5a)');
  });

  it('reports an unpublished dev run as engine dev', () => {
    expect(renderVersionReport({ harnessVersion: '0.104.0', engineVersion: 'dev' })).toBe(
      'ai-conductor 0.104.0 (engine dev)',
    );
  });
});

describe('dispatchVersionCommand', () => {
  it('prints one report line and exits 0', async () => {
    const written: string[] = [];
    const code = await dispatchVersionCommand({
      moduleDir: '/h/src/conductor/dist-versions/20260830T171713Z-1b6d3c88ea5a',
      readText: async () => '0.104.0\n',
      write: (line) => written.push(line),
    });
    expect(code).toBe(0);
    expect(written).toEqual(['ai-conductor 0.104.0 (engine 20260830T171713Z-1b6d3c88ea5a)\n']);
  });

  it('still reports the harness version when the engine build id is unresolvable', async () => {
    const written: string[] = [];
    const code = await dispatchVersionCommand({
      moduleDir: '/h/src/conductor/src',
      readText: async () => '0.104.0\n',
      write: (line) => written.push(line),
    });
    expect(code).toBe(0);
    expect(written).toEqual(['ai-conductor 0.104.0 (engine dev)\n']);
  });
});

describe('CLI surface', () => {
  it('documents `version` as a command and --version as an option', () => {
    const program = createProgram();
    expect(program.commands.map((c) => c.name())).toContain('version');
    const help = program.helpInformation();
    expect(help).toContain('--version');
  });
});
