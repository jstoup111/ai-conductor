// Covers: S3.1
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { detectDecisionsCommand, dispatchDecisions } from '../../src/engine/decisions-cli.js';
import { dispatchNonDispatchingCliCommand } from '../../src/index.js';

const execFile = promisify(execFileCallback);
const ROW_KEYS = ['path', 'kind', 'disposition', 'declared', 'date', 'title', 'summary'].sort();

let root: string;

async function writeRecord(name: string, content: string): Promise<void> {
  await writeFile(join(root, '.docs', 'decisions', name), content);
}

async function gitStatus(): Promise<string> {
  const { stdout } = await execFile('git', ['status', '--porcelain'], { cwd: root });
  return stdout;
}

async function dispatch(argv: string[]) {
  const command = detectDecisionsCommand(['node', 'ai-conductor', ...argv]);
  expect(command).not.toBeNull();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await dispatchDecisions(command!, root, {
    stdout: (line: string) => stdout.push(line),
    stderr: (line: string) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'decisions-cli-'));
  await execFile('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await writeRecord('adr-2026-01-02-runtime.md', [
    '**Date:** 2026-01-02',
    '# Runtime Decision',
    '',
    '**Status:** APPROVED',
    '',
    '## Decision',
    '',
    'Keep the runtime boring.',
  ].join('\n'));
  await writeRecord('architecture-review-2025-12-31-legacy.md', [
    '**Date:** 2025-12-31',
    '# Legacy Review',
    '',
    '**Status:** SUPERSEDED by adr-2026-01-02-runtime',
    '',
    '## Decision',
    '',
    'Legacy runtime guidance is retired.',
  ].join('\n'));
  await writeRecord('technical-assessment-2026-01-03-observability.md', [
    '**Date:** 2026-01-03',
    '# Observability Assessment',
    '',
    '## Decision',
    '',
    'Telemetry remains sufficient.',
  ].join('\n'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('detectDecisionsCommand', () => {
  it('parses decisions filters, JSON output, and one free-text term', () => {
    expect(detectDecisionsCommand([
      'node', 'ai-conductor', 'decisions', '--kind', 'review', '--status', 'superseded', '--json', 'LeGaCy',
    ])).toEqual({
      kind: 'decisions', kindFilter: 'review', status: 'superseded', json: true, term: 'LeGaCy',
    });
    expect(detectDecisionsCommand(['node', 'ai-conductor', 'daemon', 'status'])).toBeNull();
  });
});

describe('dispatchDecisions', () => {
  it('prints one text row per record and leaves git status unchanged', async () => {
    const before = await gitStatus();
    const result = await dispatch(['decisions']);

    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([]);
    expect(result.stdout).toHaveLength(3);
    expect(result.stdout.join('\n')).toMatch(/decision[\s\S]*approved[\s\S]*2026-01-02[\s\S]*Runtime Decision[\s\S]*Keep the runtime boring/i);
    expect(result.stdout.join('\n')).toMatch(/review[\s\S]*superseded[\s\S]*2025-12-31[\s\S]*Legacy Review[\s\S]*Legacy runtime guidance is retired/i);
    expect(await gitStatus()).toBe(before);
  });

  it('applies kind, status, and case-insensitive title-or-summary filters cumulatively', async () => {
    const kind = await dispatch(['decisions', '--kind', 'review']);
    const status = await dispatch(['decisions', '--status', 'superseded']);
    const term = await dispatch(['decisions', 'ReTiReD']);
    const combined = await dispatch(['decisions', '--kind', 'review', '--status', 'superseded', 'ReTiReD']);

    for (const result of [kind, status, term, combined]) {
      expect(result.code).toBe(0);
      expect(result.stderr).toEqual([]);
      expect(result.stdout).toHaveLength(1);
      expect(result.stdout.join('\n')).toContain('Legacy Review');
    }
  });

  // Covers: task:6
  it('rejects an invalid kind and names the accepted kinds', async () => {
    const result = await dispatch(['decisions', '--kind', 'bogus']);

    expect(result.code).toBe(2);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.join('\n')).toMatch(/bogus/i);
    expect(result.stderr.join('\n')).toMatch(/decision/i);
    expect(result.stderr.join('\n')).toMatch(/review/i);
    expect(result.stderr.join('\n')).toMatch(/assessment/i);
    expect(result.stderr.join('\n')).toMatch(/reference/i);
    expect(result.stderr.join('\n')).toMatch(/unclassified/i);
  });

  // Covers: task:6
  it('rejects an invalid status and names the accepted statuses', async () => {
    const result = await dispatch(['decisions', '--status', 'bogus']);

    expect(result.code).toBe(2);
    expect(result.stdout).toEqual([]);
    expect(result.stderr.join('\n')).toMatch(/bogus/i);
    expect(result.stderr.join('\n')).toMatch(/approved/i);
    expect(result.stderr.join('\n')).toMatch(/superseded/i);
    expect(result.stderr.join('\n')).toMatch(/other/i);
    expect(result.stderr.join('\n')).toMatch(/undeclared/i);
  });

  // Covers: task:6
  it('reports unreadable corpus records while retaining readable decision rows', async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const code = await dispatchDecisions(
      { kind: 'decisions', kindFilter: undefined, status: undefined, json: false, term: undefined },
      root,
      {
        readCorpus: async () => ({
          rows: [{
            path: '.docs/decisions/adr-2026-01-02-runtime.md',
            kind: 'decision',
            disposition: 'approved',
            declared: 'APPROVED',
            date: '2026-01-02',
            title: 'Runtime Decision',
            summary: 'Keep the runtime boring.',
          }],
          errors: [{
            path: '.docs/decisions/adr-2026-01-03-unreadable.md',
            error: 'EACCES: permission denied',
          }],
        }),
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      },
    );

    expect(code).toBe(1);
    expect(stdout.join('\n')).toContain('Runtime Decision');
    expect(stderr.join('\n')).toContain('.docs/decisions/adr-2026-01-03-unreadable.md');
    expect(stderr.join('\n')).toContain('EACCES: permission denied');
  });

  it('routes decisions through the injectable pre-pipeline dispatcher', async () => {
    const dispatchDecisions = vi.fn(async () => 0);
    await expect(dispatchNonDispatchingCliCommand(
      ['node', 'ai-conductor', 'decisions'], root, { dispatchDecisions },
    )).resolves.toBe(0);
    expect(dispatchDecisions).toHaveBeenCalledWith(
      { kind: 'decisions', kindFilter: undefined, status: undefined, json: false, term: undefined }, root,
    );
  });

  it('prints exactly the corpus row fields as JSON, including an empty corpus result', async () => {
    const result = await dispatch(['decisions', '--json']);

    expect(result.code).toBe(0);
    expect(result.stderr).toEqual([]);
    const rows = JSON.parse(result.stdout.join('\n')) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(3);
    for (const row of rows) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);

    await rm(join(root, '.docs', 'decisions'), { recursive: true });
    const empty = await dispatch(['decisions', '--json']);
    expect(empty).toEqual({ code: 0, stdout: ['[]'], stderr: [] });
  });
});
