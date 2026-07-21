/**
 * Task 18 — live-fire regression: computeWiringEvidence + the real
 * Conductor.completionCtx() wiring, driven against a REAL git fixture repo
 * (never a fake GitRunner). Proves the composed orchestrator (not just its
 * individual primitives) produces valid, HEAD-fresh evidence and a correct
 * satisfied/unsatisfied verdict end-to-end through the actual gate loop.
 *
 * Uses a real subprocess `git` (never the injected-fake convention used by
 * wiring-probe.test.ts) so `origin/HEAD` resolution, `merge-base`, `diff`,
 * and `grep -l -w` all exercise the genuine git plumbing computeWiringEvidence
 * depends on. gh is never invoked in either fixture (no inert waivers), so a
 * throwing stub is injected to catch any accidental call.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepRunResult } from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { readState, writeState } from '../../src/engine/state.js';
import { validateWiringEvidence, type WiringEvidence } from '../../src/engine/artifacts.js';
import type { ConductState } from '../../src/types/index.js';
import type { GitRunner } from '../../src/engine/pr-labels.js';

const execFile = promisify(execFileCb);

function frontDone(): ConductState {
  return {
    complexity_tier: 'S',
    feature_desc: 'add foo',
    worktree: 'done',
    memory: 'done',
    explore: 'done',
    prd: 'done',
    complexity: 'done',
    stories: 'done',
    conflict_check: 'skipped',
    plan: 'done',
    architecture_diagram: 'skipped',
    architecture_review: 'skipped',
    acceptance_specs: 'skipped',
    track: 'technical',
  };
}

/** Real subprocess GitRunner — matches the injected-runner convention used
 * throughout conductor.ts/wiring-probe.ts, but shells out to the genuine
 * `git` binary (bypasses the pr-labels.ts AI_CONDUCTOR_NO_REAL_EXEC guard,
 * which only fires inside `makeProductionGit()`). */
const realGit: GitRunner = async (args, opts) => {
  const result = await execFile('git', args, { cwd: opts?.cwd ?? process.cwd() });
  return { stdout: result.stdout };
};

const NEVER_CALLED_GH = async (): Promise<{ stdout: string }> => {
  throw new Error('gh should never be called by either wiring fixture in this test');
};

/**
 * Builds a real two-repo git fixture: a bare "origin" plus a working clone
 * with a base commit (pushed + fetched, so `origin/HEAD`/`origin/main`
 * resolve for computeWiringEvidence's base-derivation ladder) and a local,
 * unpushed feature commit on top (the diff computeWiringEvidence inspects).
 */
async function buildFixture(featureFiles: Record<string, string>): Promise<string> {
  const bareDir = await mkdtemp(join(tmpdir(), 'wiring-live-origin-'));
  const workDir = await mkdtemp(join(tmpdir(), 'wiring-live-work-'));
  const g = (args: string[]) => execFile('git', args, { cwd: workDir });

  await execFile('git', ['init', '-q', '--bare', '-b', 'main', bareDir]);
  await execFile('git', ['init', '-q', '-b', 'main', workDir]);
  await g(['config', 'user.email', 't@t.com']);
  await g(['config', 'user.name', 'T']);

  await mkdir(join(workDir, 'src'), { recursive: true });
  await writeFile(join(workDir, 'src', 'existing.ts'), 'export function existing() {}\n');
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'base']);

  await g(['remote', 'add', 'origin', bareDir]);
  await g(['push', '-q', 'origin', 'main']);
  await g(['fetch', '-q', 'origin']);
  await g(['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);

  for (const [relPath, content] of Object.entries(featureFiles)) {
    const full = join(workDir, relPath);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  await g(['add', '.']);
  await g(['commit', '-q', '-m', 'feature: add new export\n\nTask: 1']);

  await rm(bareDir, { recursive: true, force: true });
  return workDir;
}

describe('Task 18 — live wiring probe via real Conductor.completionCtx()', () => {
  let dir: string;
  let statePath: string;
  let events: ConductorEventEmitter;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function satisfyNonWiring(step: string): Promise<StepRunResult> {
    if (step === 'build') {
      await writeFile(
        join(dir, '.pipeline/task-status.json'),
        JSON.stringify({ tasks: [{ id: '1', status: 'completed' }] }),
      );
    } else if (step === 'build_review') {
      await writeFile(
        join(dir, '.pipeline/build-review.json'),
        JSON.stringify({
          verdict: 'PASS',
          rubric: { tautology: false, scope: false, rootCause: false },
        }),
      );
    } else if (step === 'manual_test') {
      await writeFile(
        join(dir, '.pipeline/manual-test-results.md'),
        '| Story | Result |\n|---|---|\n| foo | PASS |\n',
      );
    } else if (step === 'finish') {
      const current = await readState(statePath);
      const merged = { ...(current.ok ? current.value : {}), pr_url: 'https://example.com/pr/1' };
      await writeState(statePath, merged);
      await writeFile(join(dir, '.pipeline/finish-choice'), 'pr');
    }
    return { success: true };
  }

  function makeConductor(runner: StepRunner): Conductor {
    return new Conductor({
      stateFilePath: statePath,
      stepRunner: runner,
      events,
      projectRoot: dir,
      verifyArtifacts: true,
      mode: 'auto',
      fromStep: 'build',
      maxRetries: 1,
      daemon: true,
      config: { build_review: { enabled: true } },
      git: realGit,
      gh: NEVER_CALLED_GH,
    });
  }

  describe('positive fixture — declared Wired-into with a real production caller', () => {
    beforeEach(async () => {
      dir = await buildFixture({
        'src/feature.ts': 'export function newFeatureExport() { return 1; }\n',
        'src/caller.ts':
          "import { newFeatureExport } from './feature.js';\nnewFeatureExport();\n",
        '.docs/plans/add-foo.md': [
          '### Task 1: Add feature',
          '**Files:** src/feature.ts, src/caller.ts',
          '**Wired-into:** src/caller.ts#newFeatureExport',
          '',
        ].join('\n'),
      });
      statePath = join(dir, '.pipeline/conduct-state.json');
      events = new ConductorEventEmitter();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
    });

    it('ctx.wiringProbe computes valid, HEAD-fresh evidence and the gate is satisfied (no kickback to build)', async () => {
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });

      await writeState(statePath, frontDone());

      const runner: StepRunner = {
        run: async (step) => satisfyNonWiring(step),
      };

      await makeConductor(runner).run();

      // No wiring_check kickback to build — the fixture's declared contract
      // is genuinely satisfied (a real caller references the new export).
      expect(kicks.filter((k) => k.from === 'wiring_check' && k.to === 'build')).toEqual([]);

      const written = await readFile(join(dir, '.pipeline/wiring-evidence.json'), 'utf-8');
      const parsed: unknown = JSON.parse(written);
      const currentHead = (await execFile('git', ['rev-parse', 'HEAD'], { cwd: dir })).stdout.trim();
      expect(validateWiringEvidence(parsed, currentHead)).toEqual({ ok: true });

      const evidence = parsed as WiringEvidence;
      const allGaps = evidence.tasks.flatMap((t) => t.gaps);
      expect(allGaps).toEqual([]);
    });
  });

  describe('negative fixture — new export with no Wired-into declaration and no caller (orphan)', () => {
    beforeEach(async () => {
      dir = await buildFixture({
        'src/orphan.ts': 'export function orphanedThing() { return 2; }\n',
        '.docs/plans/add-foo.md': [
          '### Task 1: Add feature',
          '**Files:** src/orphan.ts',
          '**Wired-into:** none (no new production surface)',
          '',
        ].join('\n'),
      });
      statePath = join(dir, '.pipeline/conduct-state.json');
      events = new ConductorEventEmitter();
      await mkdir(join(dir, '.pipeline'), { recursive: true });
    });

    it('ctx.wiringProbe computes evidence with satisfied:false naming the orphaned symbol, kicking back to build', async () => {
      const kicks: Array<{ from: string; to: string }> = [];
      events.on('kickback', (e) => {
        if (e.type === 'kickback') kicks.push({ from: e.from, to: e.to });
      });

      await writeState(statePath, frontDone());

      const runner: StepRunner = {
        run: async (step) => satisfyNonWiring(step),
      };

      await makeConductor(runner).run();

      expect(kicks).toContainEqual({ from: 'wiring_check', to: 'build' });

      const written = await readFile(join(dir, '.pipeline/wiring-evidence.json'), 'utf-8');
      const parsed = JSON.parse(written) as WiringEvidence;
      const allGapMessages = parsed.tasks.flatMap((t) => t.gaps.map((g) => g.message));
      expect(allGapMessages.some((m) => m.includes('orphanedThing'))).toBe(true);
    });
  });
});
