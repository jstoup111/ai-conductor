/**
 * Covers: S1.1, S4.1, S4.2, S4.3, S4.4, S4.5, task:9
 *
 * Acceptance coverage for marker-gated project setup and setup-triage's
 * forced verification paths. These specs exercise real local Git, the real
 * project setup process, the real daemon feature runner / triage functions,
 * and the real event persister. No provider or other third-party boundary is
 * reachable.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeRunFeature, type FeatureRunnerDeps } from '../../src/engine/daemon-runner.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { makeGitRunner } from '../../src/engine/rebase.js';
import { fixSession, runTriage } from '../../src/engine/setup-triage.js';
import {
  prepareWorktree,
  SETUP_SCRIPT,
  SetupFailureError,
} from '../../src/engine/worktree-prepare.js';
import type { BacklogItem } from '../../src/engine/daemon.js';
import type { ConductorEvent } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

const execFileAsync = promisify(execFile);
const SETUP_MARKER = join('.daemon', 'setup-ok.json');

describe('acceptance: setup once per worktree and forced triage verification (#1930)', () => {
  let worktree: string;
  let counterPath: string;

  async function git(...args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', ['-C', worktree, ...args]);
    return stdout.trim();
  }

  async function initialiseRepo(): Promise<string> {
    await execFileAsync('git', ['init', '-b', 'main', worktree]);
    await git('config', 'user.email', 'test@example.com');
    await git('config', 'user.name', 'Test');
    await git('config', 'commit.gpgsign', 'false');
    await writeFile(join(worktree, '.gitignore'), '.env\n.pipeline/\n.daemon/\n', 'utf8');
    await mkdir(join(worktree, 'bin'), { recursive: true });
    await writeFile(
      join(worktree, SETUP_SCRIPT),
      `#!/usr/bin/env bash
count=0
if [ -f "${counterPath}" ]; then count=$(<"${counterPath}"); fi
count=$((count + 1))
echo "$count" > "${counterPath}"
if [ "$count" -gt 1 ]; then
  echo "SETUP_MUST_RUN_DURING_TRIAGE" >&2
  exit 1
fi
exit 0
`,
      'utf8',
    );
    await chmod(join(worktree, SETUP_SCRIPT), 0o755);
    await git('add', '-A');
    await git('commit', '-m', 'fixture: add stateful setup');
    return git('rev-parse', 'HEAD');
  }

  function prepareOptions(
    baseSha: string,
    events?: ConductorEventEmitter,
    force = false,
  ) {
    // `baseSha`, `events`, and `force` are the accepted plan's forward-declared
    // prepare options. Keeping `verbose` makes this object assignable to the
    // pre-implementation signature while the acceptance spec is RED.
    return { verbose: false, baseSha, events, force };
  }

  async function invocationCount(): Promise<number> {
    return Number.parseInt(await readFile(counterPath, 'utf8'), 10);
  }

  async function persistedEvents(): Promise<ConductorEvent[]> {
    const raw = await readFile(join(worktree, '.pipeline', 'events.jsonl'), 'utf8');
    return raw
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ConductorEvent);
  }

  beforeEach(async () => {
    worktree = await mkdtemp(join(tmpdir(), 'setup-once-acceptance-'));
    counterPath = join(tmpdir(), `setup-once-counter-${randomUUID()}`);
  });

  afterEach(async () => {
    await rm(worktree, { recursive: true, force: true });
    await rm(counterPath, { force: true });
  });

  it('S1.1/S4.3: a prepared feature redispatch skips setup, persists marker-valid, and never invokes triage', async () => {
    const baseSha = await initialiseRepo();
    await prepareWorktree(worktree, undefined, prepareOptions(baseSha));
    await expect(readFile(join(worktree, SETUP_MARKER), 'utf8')).resolves.toContain(baseSha);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();

    const runSetupTriage = vi.fn(async () => ({ kind: 'pass' as const, outputTail: '' }));
    let conductorCalls = 0;
    const deps: FeatureRunnerDeps = {
      createWorktree: async () => ({ path: worktree, branch: 'feat/setup-once' }),
      prepareWorktree: async (featureWorktree) => {
        await prepareWorktree(
          featureWorktree.path,
          undefined,
          prepareOptions(baseSha, events),
        );
      },
      runConductor: async () => {
        conductorCalls += 1;
      },
      readOutcome: async () => ({
        done: true,
        halted: false,
        finishChoice: 'pr',
        prUrl: 'https://example.test/pr/1',
      }),
      shipmentEvidence: async (input) => ({
        kind: 'valid',
        slug: input.slug,
        pr: input.implementationPr,
        recordPath: `.docs/shipped/${input.slug}.md`,
        hash: 'fixture-hash',
        commit: input.candidateCommit,
      }),
      teardownWorktree: async () => {},
      markProcessed: async () => {},
      daemon: true,
      project: 'acceptance-fixture',
      runSetupTriage,
    };

    try {
      const outcome = await makeRunFeature(deps)({ slug: 'setup-once' } as BacklogItem);

      expect(outcome.status).toBe('done');
      expect(conductorCalls).toBe(1);
      expect(runSetupTriage).not.toHaveBeenCalled();
      expect(await invocationCount()).toBe(1);
      expect(await persistedEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'project_setup',
            ran: false,
            reason: 'marker-valid',
          }),
        ]),
      );
    } finally {
      persister.stop();
    }
  });

  it('S4.1/S4.2/S4.4/S4.5: post-fix verification bypasses a valid marker and persists forced failure evidence', async () => {
    const baseSha = await initialiseRepo();
    await prepareWorktree(worktree, undefined, prepareOptions(baseSha));
    await expect(readFile(join(worktree, SETUP_MARKER), 'utf8')).resolves.toContain(baseSha);

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      const outcome = await fixSession(
        makeGitRunner(worktree),
        worktree,
        'setup-once-fix',
        async () => {},
        async (path) => {
          await prepareWorktree(path, undefined, prepareOptions(baseSha, events, true));
        },
      );

      expect(outcome).toMatchObject({
        kind: 'park',
        contractOutcome: 'setup-still-failing',
      });
      expect(outcome.outputTail).toContain('SETUP_MUST_RUN_DURING_TRIAGE');
      expect(await invocationCount()).toBe(2);
      await expect(readFile(join(worktree, SETUP_MARKER), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      expect(await persistedEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'project_setup', ran: true, reason: 'forced' }),
        ]),
      );
    } finally {
      persister.stop();
    }
  });

  it('S4.1/S4.2/S4.4/S4.5: post-quarantine verification bypasses a valid marker and observes the real failing setup', async () => {
    const baseSha = await initialiseRepo();
    await prepareWorktree(worktree, undefined, prepareOptions(baseSha));
    await expect(readFile(join(worktree, SETUP_MARKER), 'utf8')).resolves.toContain(baseSha);
    await writeFile(join(worktree, 'dirty.txt'), 'uncommitted work\n', 'utf8');

    const events = new ConductorEventEmitter();
    const persister = new EventPersister(join(worktree, '.pipeline', 'events.jsonl'), events);
    persister.start();
    try {
      const outcome = await runTriage(
        makeGitRunner(worktree),
        worktree,
        'setup-once-quarantine',
        new SetupFailureError('prior setup failure', 'PRIOR_FAILURE'),
        async (path) => {
          await prepareWorktree(path, undefined, prepareOptions(baseSha, events, true));
        },
      );

      expect(outcome).toMatchObject({
        kind: 'park',
        quarantineRef: 'wip/setup-quarantine-setup-once-quarantine',
      });
      expect(outcome.outputTail).toContain('SETUP_MUST_RUN_DURING_TRIAGE');
      expect(await invocationCount()).toBe(2);
      expect(await persistedEvents()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'project_setup', ran: true, reason: 'forced' }),
        ]),
      );
    } finally {
      persister.stop();
    }
  });
});
