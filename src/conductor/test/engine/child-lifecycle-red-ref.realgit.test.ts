// Covers: task:53
import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeChild } from '../../src/engine/child-lifecycle.js';
import { parseChildId } from '../../src/engine/child-context.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFile = promisify(execFileCallback);
const child = parseChildId(1)!;
const lifecycleTarget = { child, position: child, branch: 'feat/c1/demo' };
const redRef = 'refs/conductor/demo/red/c1';

let repository: string;

async function git(args: string[]): Promise<string> {
  return (await execFile('git', args, { cwd: repository })).stdout;
}

async function configureRouting(enabled: boolean): Promise<void> {
  await mkdir(join(repository, '.ai-conductor'), { recursive: true });
  await writeFile(join(repository, '.ai-conductor', 'config.yml'), [
    'stacked_prs:',
    `  route_whole_feature_fixes: ${enabled}`,
    '',
  ].join('\n'));
}

async function writeRedMarker(content = '{"outcome":"specs-generated"}\n'): Promise<string> {
  const markerPath = join(repository, '.pipeline', 'children', '1', 'acceptance-specs-red.json');
  await mkdir(join(markerPath, '..'), { recursive: true });
  await writeFile(markerPath, content);
  return content;
}

async function writeRedRef(digest: string): Promise<string> {
  const blob = (await makeGitRunner(repository)(['hash-object', '-w', '--stdin'], { input: digest })).stdout.trim();
  await git(['update-ref', redRef, blob]);
  return blob;
}

beforeEach(async () => {
  repository = await mkdtemp(join(tmpdir(), 'child-lifecycle-red-ref-'));
  await git(['init', '-q', '-b', 'feat/daemon-demo']);
  await git(['config', 'user.email', 'routing@example.test']);
  await git(['config', 'user.name', 'Routing']);
  await writeFile(join(repository, 'base.txt'), 'base\n');
  await git(['add', 'base.txt']);
  await git(['commit', '-qm', 'base']);
  await git(['branch', lifecycleTarget.branch]);
});

afterEach(async () => {
  await rm(repository, { recursive: true, force: true });
});

describe('closeChild RED ref (real local Git)', () => {
  it('creates a red ref whose blob holds the child RED marker digest when routing is on', async () => {
    await configureRouting(true);
    const marker = await writeRedMarker();
    const digest = createHash('sha256').update(marker, 'utf8').digest('hex');

    await expect(closeChild(repository, 'demo', lifecycleTarget, new ConductorEventEmitter()))
      .resolves.toEqual({ kind: 'completed' });

    const blob = (await git(['rev-parse', redRef])).trim();
    await expect(git(['cat-file', '-p', blob])).resolves.toBe(digest);
  });

  it('does not create a red ref when routing is off', async () => {
    await configureRouting(false);
    await writeRedMarker();

    await expect(closeChild(repository, 'demo', lifecycleTarget, new ConductorEventEmitter()))
      .resolves.toEqual({ kind: 'completed' });
    await expect(git(['show-ref', '--verify', '--quiet', redRef])).rejects.toMatchObject({ code: 1 });
  });

  it('does not create a red ref when the child has no RED marker', async () => {
    await configureRouting(true);

    await expect(closeChild(repository, 'demo', lifecycleTarget, new ConductorEventEmitter()))
      .resolves.toEqual({ kind: 'completed' });
    await expect(git(['show-ref', '--verify', '--quiet', redRef])).rejects.toMatchObject({ code: 1 });
  });

  it('accepts an existing same-digest red ref without replacing its blob', async () => {
    await configureRouting(true);
    const marker = await writeRedMarker();
    const digest = createHash('sha256').update(marker, 'utf8').digest('hex');
    const existing = await writeRedRef(digest);

    await expect(closeChild(repository, 'demo', lifecycleTarget, new ConductorEventEmitter()))
      .resolves.toEqual({ kind: 'completed' });

    await expect(git(['rev-parse', redRef])).resolves.toBe(`${existing}\n`);
  });

  it('refuses an existing different-digest red ref without replacing its blob', async () => {
    await configureRouting(true);
    await writeRedMarker();
    const existing = await writeRedRef('sha256:different');

    await expect(closeChild(repository, 'demo', lifecycleTarget, new ConductorEventEmitter()))
      .resolves.toMatchObject({ kind: 'refused', reason: expect.stringContaining(redRef) });

    await expect(git(['rev-parse', redRef])).resolves.toBe(`${existing}\n`);
  });
});
