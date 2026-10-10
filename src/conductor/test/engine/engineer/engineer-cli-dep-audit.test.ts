// Covers: task:16
// The dep-audit command is an engineer CLI boundary: it resolves the registry
// before it creates its read-only tracker and reports each drift category.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectEngineerCommand,
  dispatchEngineer,
  type DispatchEngineerOpts,
} from '../../../src/engine/engineer-cli.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';

const argv = (...rest: string[]) => ['node', 'conduct-ts', 'compose', ...rest];

function recordingGh(
  issues: Array<{ number: number; body: string }>,
  blockers: Record<number, unknown[]>,
  { failListing = false, failBlockedBy }: { failListing?: boolean; failBlockedBy?: number } = {},
): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push(args);
    if (args[0] === 'issue' && args[1] === 'list') {
      if (failListing) throw new Error('tracker unavailable');
      return { stdout: JSON.stringify(issues) };
    }
    const path = args.find((arg) => arg.includes('/dependencies/blocked_by'));
    if (path) {
      const number = Number(path.match(/issues\/(\d+)\//)?.[1]);
      if (number === failBlockedBy) throw new Error('rate limited');
      return { stdout: JSON.stringify(blockers[number] ?? []) };
    }
    throw new Error(`unexpected tracker call: ${args.join(' ')}`);
  };
  return { gh, calls };
}

let root: string;
let registryPath: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'engineer-cli-dep-audit-'));
  registryPath = join(root, 'registry.json');
  await writeFile(registryPath, JSON.stringify([{
    schemaVersion: 1,
    name: 'alpha',
    path: join(root, 'alpha'),
    remote: 'https://github.com/acme/app.git',
    status: 'registered',
    registeredAt: '2026-10-10T00:00:00.000Z',
  }]));
});

afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function run(gh: GhRunner, project = 'alpha') {
  const out: string[] = [];
  const err: string[] = [];
  const command = detectEngineerCommand(argv('dep-audit', '--project', project));
  const opts: DispatchEngineerOpts = {
    registryPath,
    print: (line) => out.push(line),
    printErr: (line) => err.push(line),
    probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
    gh,
  };
  return { out, err, code: dispatchEngineer(command!, opts) };
}

describe('compose dep-audit', () => {
  it('prints all drift categories and uses only the read-only tracker seam', async () => {
    const { gh, calls } = recordingGh(
      [
        { number: 30, body: 'Blocked by #31.' },
        { number: 32, body: '' },
        { number: 34, body: '' },
        { number: 35, body: '' },
        { number: 36, body: 'Blocks #37.' },
      ],
      {
        30: [], 32: [{ number: 33, state: 'closed', state_reason: 'not_planned' }],
        34: [{ number: 35, state: 'open' }], 35: [{ number: 34, state: 'open' }],
        36: [{ number: 37, state: 'open' }],
      },
    );
    const result = run(gh);

    await expect(result.code).resolves.toBe(0);
    expect(result.err).toEqual([]);
    const report = result.out.join('\n');
    expect(report).toContain('acme/app#30 → acme/app#31');
    expect(report).toContain('acme/app#32 → acme/app#33');
    expect(report).toContain('acme/app#34');
    expect(report).toContain('acme/app#35');
    expect(report).toContain('acme/app#36 → acme/app#37');
    expect(calls).toHaveLength(6);
    expect(calls.every((args) => !args.includes('--method') && !args.includes('POST'))).toBe(true);
  });

  it('prints zero findings for each category on a clean sweep', async () => {
    const clean = run(recordingGh([{ number: 50, body: '' }], { 50: [] }).gh);
    await expect(clean.code).resolves.toBe(0);
    expect(clean.out.join('\n')).toMatch(/unlinked: 0 findings/i);
    expect(clean.out.join('\n')).toMatch(/stale: 0 findings/i);
    expect(clean.out.join('\n')).toMatch(/cycles: 0 findings/i);
    expect(clean.out.join('\n')).toMatch(/contradictions: 0 findings/i);
  });

  it('prints an indeterminate repository distinctly from zero findings', async () => {
    const indeterminate = run(recordingGh([], {}, { failListing: true }).gh);
    await expect(indeterminate.code).resolves.toBe(0);
    expect(indeterminate.out.join('\n')).toContain('indeterminate');
    expect(indeterminate.out.join('\n')).not.toMatch(/unlinked: 0 findings/i);
  });

  it('refuses an unregistered project before making a tracker call', async () => {
    const { gh, calls } = recordingGh([], {});
    const out: string[] = [];
    const err: string[] = [];
    const command = detectEngineerCommand(argv('dep-audit', '--project', 'missing'));
    const code = await dispatchEngineer(command!, {
      registryPath,
      print: (line) => out.push(line),
      printErr: (line) => err.push(line),
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      gh,
    });

    expect(code).toBe(1);
    expect(err.join('\n')).toContain('missing');
    expect(calls).toEqual([]);
    expect(out).toEqual([]);
  });
});
