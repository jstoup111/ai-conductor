import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { makeFeatureRunnerDeps } from '../../src/engine/daemon-deps.js';
import { isOperatorParked } from '../../src/engine/park-marker.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type {
  FeatureWorktree,
} from '../../src/engine/daemon-runner.js';
import type { OperatorParkedTermination } from '../../src/engine/conductor.js';

describe('daemon operator-park boundary wiring', () => {
  let mainRoot: string;
  let worktreeRoot: string;

  beforeEach(async () => {
    mainRoot = await mkdtemp(join(tmpdir(), 'daemon-boundary-main-'));
    worktreeRoot = join(mainRoot, '.worktrees', 'feature-a');
    await mkdir(worktreeRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(mainRoot, { recursive: true, force: true });
  });

  it('propagates the conductor termination unchanged through real daemon deps', async () => {
    const marker = join(mainRoot, '.daemon', 'parked', 'feature-a');
    await mkdir(join(mainRoot, '.daemon', 'parked'), { recursive: true });
    await writeFile(marker, 'operator\n');
    const termination: OperatorParkedTermination = {
      kind: 'operator-parked',
      boundary: { kind: 'pre-first-unit' },
    };
    const runConductorInWorktree = vi.fn(async () => {
      expect(await isOperatorParked(mainRoot, 'feature-a')).toBe(true);
      await rm(marker);
      return termination;
    });
    const deps = makeFeatureRunnerDeps({
      projectRoot: mainRoot,
      worktreeBase: join(mainRoot, '.worktrees'),
      baseBranch: 'main',
      runConductorInWorktree,
    });
    const worktree: FeatureWorktree = {
      path: worktreeRoot,
      branch: 'feat/daemon-feature-a',
    };
    const item = { slug: 'feature-a' } as BacklogItem;

    const result = await deps.runConductor(worktree, item);

    expect(result).toBe(termination);
    expect(await isOperatorParked(mainRoot, 'feature-a')).toBe(false);
    expect(runConductorInWorktree).toHaveBeenCalledWith(
      worktree,
      item,
      undefined,
      undefined,
      undefined,
    );
  });

  it('returns a typed pre-first-unit stop from the pre-rebase park decision', async () => {
    const source = await readFile(
      new URL('../../src/daemon-cli.ts', import.meta.url),
      'utf8',
    );
    const preRebasePark = source.match(
      /const parked = await isOperatorParked\(projectRoot, item\.slug\);[\s\S]*?const resume = await resumeRebaseFirst/,
    )?.[0];

    expect(preRebasePark).toBeDefined();
    expect(preRebasePark).toMatch(
      /const termination: OperatorParkedTermination = \{\s*kind: 'operator-parked',\s*boundary: \{ kind: 'pre-first-unit' \},\s*\};\s*return termination;/,
    );
  });

  it('binds the daemon predicate to main projectRoot and item.slug, never the worktree root', async () => {
    const source = await readFile(
      new URL('../../src/daemon-cli.ts', import.meta.url),
      'utf8',
    );
    const constructor = source.match(
      /const conductor = new Conductor\(\{[\s\S]*?\n    \}\);/,
    )?.[0];

    expect(constructor).toBeDefined();
    expect(constructor).toContain('featureSlug: item.slug');
    expect(constructor).toMatch(
      /operatorParkBoundary:\s*\(\)\s*=>\s*isOperatorParked\(\s*projectRoot,\s*item\.slug,\s*\(error\)\s*=>\s*featureLog\(`operator park marker read failed: \$\{error\.message\}`\),?\s*\)/,
    );
    expect(constructor).not.toMatch(
      /operatorParkBoundary:[\s\S]*?isOperatorParked\(wt\.path/,
    );
  });

  it('reads main-root authority even when the worktree has no marker', async () => {
    const slug = 'feature-a';
    await mkdir(join(mainRoot, '.daemon', 'parked'), { recursive: true });
    await writeFile(join(mainRoot, '.daemon', 'parked', slug), 'operator\n');

    expect(await isOperatorParked(mainRoot, slug)).toBe(true);
    expect(await isOperatorParked(worktreeRoot, slug)).toBe(false);
  });

  it('fails toward parked when the authoritative marker cannot be read as a file', async () => {
    const slug = 'feature-a';
    await mkdir(join(mainRoot, '.daemon', 'parked', slug), { recursive: true });
    const anomalies: Error[] = [];

    const parked = await isOperatorParked(mainRoot, slug, (error) => {
      anomalies.push(error);
    });

    expect(parked).toBe(true);
    expect(anomalies).toHaveLength(1);
  });
});
