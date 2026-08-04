/**
 * RED acceptance contract for implementation-only remediation routing.
 *
 * Story coverage:
 * - S1: both machine-consumed planner surfaces classify conforming
 *   implementation/test/documentation drift as BUILD, independent of the
 *   audit that reported it; the real planRemediation entry point then appends
 *   the concrete task and routes to BUILD.
 * - S2: both surfaces reserve architecture_review for changing or clarifying
 *   approved architecture and keep in-scope plan omissions on the plan route.
 * - S3: both surfaces reject disposition/rationale contradictions in either
 *   direction.
 *
 * Existing coverage intentionally reused rather than duplicated:
 * - test/engine/conductor-remediation-noop-guard.test.ts proves taskless or
 *   already-complete BUILD remediation does not invent dispatchable work.
 * - test/acceptance/daemon-decide-kickback-halt.acceptance.test.ts proves the
 *   daemon's real DECIDE guard halts before re-authoring protected artifacts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductState } from '../../src/types/index.js';

const CONDUCTOR_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const REPO_ROOT = join(CONDUCTOR_ROOT, '..', '..');

const CONTRACT_SURFACES = [
  ['remediate skill', 'skills/remediate/SKILL.md'],
  ['remediation planner', 'agents/remediation-planner.md'],
] as const;

describe.each(CONTRACT_SURFACES)('%s authority contract', (_label, relativePath) => {
  async function contract(): Promise<string> {
    return readFile(join(REPO_ROOT, relativePath), 'utf8');
  }

  it('reserves architecture_review for changing or clarifying approved architecture', async () => {
    const text = await contract();

    expect(text).toMatch(
      /architecture_review[\s\S]{0,500}(?:chang(?:e|ing)|clarif(?:y|ying|ication))[\s\S]{0,180}approved architecture/i,
    );
    expect(text).not.toMatch(
      /architecture_review[^\n|]*(?:correct fix is clear|needs no decision|no decision needed)/i,
    );
  });

  it('routes drift that preserves approved architecture to build regardless of audit origin', async () => {
    const text = await contract();

    expect(text).toMatch(/approved architecture remains (?:applicable|authoritative)/i);
    expect(text).toMatch(
      /(?:implementation|impl)[\s/,_-]*(?:test|tests)[\s/,_-]*(?:documentation|docs)[\s\S]{0,240}\bbuild\b/i,
    );
    expect(text).toMatch(
      /(?:origin|reported by|finding id)[\s\S]{0,160}(?:alone|itself)[\s\S]{0,160}(?:does not|never)[\s\S]{0,100}(?:determine|select|decide)/i,
    );
  });

  it('keeps an in-scope planning omission on the plan route', async () => {
    const text = await contract();

    expect(text).toMatch(
      /\bplan\b[\s\S]{0,300}(?:in scope|in-scope)[\s\S]{0,180}(?:omission|omitted|missed)/i,
    );
    expect(text).toMatch(/(?:planning|plan)[ -](?:omission|miss)[\s\S]{0,160}not (?:an? )?(?:architecture|design)/i);
  });

  it('rejects both disposition/rationale contradiction directions', async () => {
    const text = await contract();

    expect(text).toMatch(
      /architecture_review[\s\S]{0,260}no (?:architecture|architectural|product) decision[\s\S]{0,180}(?:reject|invalid|forbidden|contradict)/i,
    );
    expect(text).toMatch(
      /\bbuild\b[\s\S]{0,260}(?:unresolved|ambiguous)[\s\S]{0,100}(?:architecture|architectural)[\s\S]{0,180}(?:reject|invalid|forbidden|contradict)/i,
    );
  });
});

describe('S1 #1250-shaped remediation plan through the real engine boundary', () => {
  let projectRoot: string;
  let planPath: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'remediation-authority-routing-'));
    planPath = join(projectRoot, '.docs/plans/feature.md');
    await mkdir(join(projectRoot, '.docs/plans'), { recursive: true });
    await mkdir(join(projectRoot, '.pipeline'), { recursive: true });
    await writeFile(planPath, '# Implementation plan\n\n### Task 1: existing work\n', 'utf8');
    await writeFile(
      join(projectRoot, '.pipeline/engine-state.json'),
      JSON.stringify({ activePlanPath: planPath }),
      'utf8',
    );
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('appends a pending file-scoped task and routes to BUILD without invoking the DECIDE guard', async () => {
    const sessionStartedAt = Date.now() - 1_000;
    const runner: StepRunner = {
      run: async (step) => {
        expect(step).toBe('remediate');
        await writeFile(
          join(projectRoot, '.pipeline/remediation.json'),
          JSON.stringify({
            dispositions: [
              {
                id: 'adr-2026-07-27-provider-lifecycle',
                disposition: 'build',
                category: null,
                rationale:
                  'Approved architecture remains authoritative; src/provider-home.ts:42 and its tests need concrete cleanup.',
                tasks: [
                  {
                    id: 'rem-adr-1250-1',
                    title:
                      'src/provider-home.ts:42 — align the implementation and tests with the approved provider lifecycle',
                    status: 'pending',
                  },
                ],
              },
            ],
          }),
          'utf8',
        );
        return { success: true };
      },
    };
    const conductor = new Conductor({
      stateFilePath: join(projectRoot, '.pipeline/conduct-state.json'),
      stepRunner: runner,
      events: new ConductorEventEmitter(),
      projectRoot,
      mode: 'auto',
      daemon: true,
      verifyArtifacts: false,
      maxRetries: 1,
    });

    const outcome = await (conductor as unknown as {
      planRemediation: (
        state: ConductState,
        steps: typeof ALL_STEPS,
        dispatchContext: string,
        hintSource: { source: string; evidenceFile: string },
      ) => Promise<{ kind: string; target?: string }>;
    }).planRemediation(
      {
        session_started_at: sessionStartedAt,
        feature_desc: 'feature',
      } as ConductState,
      ALL_STEPS,
      'as-built architecture review blocked',
      {
        source: 'architecture-review-as-built',
        evidenceFile: '.pipeline/architecture-review-as-built.md',
      },
    );

    expect(outcome).toMatchObject({ kind: 'route', target: 'build' });

    const plan = await readFile(planPath, 'utf8');
    expect(plan).toContain(
      '### Task rem-adr-1250-1: src/provider-home.ts:42 — align the implementation and tests with the approved provider lifecycle',
    );
    const taskStatus = JSON.parse(
      await readFile(join(projectRoot, '.pipeline/task-status.json'), 'utf8'),
    ) as { tasks: Array<{ id: string; status: string }> };
    expect(taskStatus.tasks).toContainEqual(
      expect.objectContaining({ id: 'rem-adr-1250-1', status: 'pending' }),
    );
  });
});
