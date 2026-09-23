// Covers: task:7
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createProductionFinishPublicationCoordinator,
  createProductionReleaseReadinessObserver,
} from '../../src/engine/finish-publication-production.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import type { ConductState } from '../../src/types/index.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('production FINISH custom-gate refusal', () => {
  it('persists the missing custom gate blocker before any provider or publication transition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'finish-custom-gate-blocked-'));
    const pipeline = join(root, '.pipeline');
    const eventsPath = join(pipeline, 'events.jsonl');
    const emitter = new ConductorEventEmitter();
    const persister = new EventPersister(eventsPath, emitter);
    const git = vi.fn(async () => { throw new Error('publication must not run'); });
    const gh = vi.fn(async () => { throw new Error('publication must not run'); });
    const dispatchJudgment = vi.fn(async () => ({ success: true }));
    try {
      await mkdir(pipeline);
      persister.start();
      const coordinator = createProductionFinishPublicationCoordinator({
        projectRoot: root,
        stateFilePath: join(pipeline, 'conduct-state.json'),
        baseBranch: 'main',
        git,
        gh,
        observeReleaseReadiness: createProductionReleaseReadinessObserver({
          projectRoot: root,
          config: {
            steps: {
              'compliance-gate': {
                after: 'rebase',
                skill: 'compliance/SKILL.md',
                enforcement: 'gating',
                completion_artifact: '.pipeline/compliance-gate-pass',
              },
            },
          },
        }),
      });

      await expect(coordinator.advance({
        state: {
          feature_desc: 'feature',
          worktree_branch: 'feat/feature',
          build_review: 'done',
          test_suite: 'done',
          manual_test: 'done',
          architecture_review_as_built: 'done',
          'compliance-gate': 'done',
        } as ConductState,
        mode: 'auto',
        daemon: true,
        dispatchJudgment,
        emit: (event) => emitter.emit(event),
      })).resolves.toMatchObject({
        kind: 'publication_retry',
        condition: { code: 'release_readiness_missing', steps: ['compliance-gate'] },
      });

      persister.stop();
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      expect(events).toContainEqual(expect.objectContaining({
        type: 'finish_publication_blocked',
        condition: expect.objectContaining({
          code: 'release_readiness_missing',
          steps: ['compliance-gate'],
        }),
      }));
      expect(events).not.toContainEqual(expect.objectContaining({ type: 'finish_publication_transition' }));
      expect(dispatchJudgment).not.toHaveBeenCalled();
    } finally {
      persister.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
