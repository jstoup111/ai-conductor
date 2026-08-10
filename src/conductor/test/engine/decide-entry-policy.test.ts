import { expect, it } from 'vitest';
import {
  consumeOperatorGrant,
  decideEntryDisposition,
  readOperatorGrant,
  resolveGrantPath,
} from '../../src/engine/decide-entry-policy.js';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ComplexityTier, StepDefinition, StepName } from '../../src/types/index.js';

type Input = Parameters<typeof decideEntryDisposition>[0];

function decideStep(overrides: Partial<StepDefinition> = {}): StepDefinition {
  return {
    name: 'plan',
    label: 'Plan',
    phase: 'DECIDE',
    enforcement: 'gating',
    prerequisites: [],
    skippableForTiers: [],
    isCheckpoint: false,
    ...overrides,
  };
}

function input(target: StepName, steps: StepDefinition[]): Input {
  return {
    target,
    steps,
    daemon: true,
    tier: 'L',
    hasContract: true,
    satisfied: false,
    grant: null,
    sourceGate: 'forward-walk',
  };
}

function summary(disposition: ReturnType<typeof decideEntryDisposition>): string {
  return disposition.kind === 'fast-forward'
    ? `${disposition.kind}:${disposition.as}`
    : disposition.kind;
}

it('applies every ordered autonomous DECIDE-entry disposition rule', () => {
  const tierSkippable = decideStep({ skippableForTiers: ['S'] });
  const noPhase = { ...decideStep(), phase: undefined } as unknown as StepDefinition;
  const customTarget = 'custom_decide' as StepName;
  const customDecideStep = decideStep({
    name: customTarget,
    label: 'Custom DECIDE',
  });
  const storiesStep = decideStep({ name: 'stories', label: 'Stories' });
  const grant = {
    version: 1,
    step: 'plan' as StepName,
    reason: 'operator approved one authoring pass',
    grantedAt: '2026-08-07T00:00:00.000Z',
    grantedBy: 'operator',
  };
  const cases: Array<{ name: string; input: Input; expected: string }> = [
    {
      name: 'interactive runs pass through before target resolution',
      input: { ...input('remediate', []), daemon: false },
      expected: 'enter',
    },
    {
      name: 'an unresolved target halts',
      input: input('remediate', []),
      expected: 'halt',
    },
    {
      name: 'an undefined target phase halts',
      input: input('plan', [noPhase]),
      expected: 'halt',
    },
    ...ALL_STEPS
      .filter((step) => step.phase !== 'DECIDE')
      .map((step) => ({
        name: `known ${step.phase} target ${step.name} enters`,
        input: input(step.name, ALL_STEPS),
        expected: 'enter',
      })),
    {
      name: 'a tier-skippable DECIDE target fast-forwards as skipped',
      input: { ...input('plan', [tierSkippable]), tier: 'S' as ComplexityTier },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'tier skippability beats no contract, satisfaction, and a grant',
      input: {
        ...input('plan', [tierSkippable]),
        tier: 'S' as ComplexityTier,
        hasContract: false,
        satisfied: true,
        grant,
      },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'a DECIDE target without a completion contract fast-forwards as skipped',
      input: { ...input('plan', [decideStep()]), hasContract: false },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'no completion contract beats satisfaction and a grant',
      input: {
        ...input('plan', [decideStep()]),
        hasContract: false,
        satisfied: true,
        grant,
      },
      expected: 'fast-forward:skipped',
    },
    {
      name: 'a satisfied DECIDE target fast-forwards as done',
      input: { ...input('plan', [decideStep()]), satisfied: true },
      expected: 'fast-forward:done',
    },
    {
      name: 'satisfaction beats a grant',
      input: { ...input('plan', [decideStep()]), satisfied: true, grant },
      expected: 'fast-forward:done',
    },
    {
      name: 'an in-scope grant NEVER permits autonomous entry to plan',
      input: { ...input('plan', [decideStep()]), grant },
      expected: 'halt',
    },
    {
      name: 'plan is refused before the grant is even considered',
      input: {
        ...input('plan', [decideStep()]),
        grant: { ...grant, grantedBy: 'operator', reason: 'explicitly approved' },
      },
      expected: 'halt',
    },
    {
      name: 'an in-scope grant still permits entry to a non-plan DECIDE target',
      input: {
        ...input('stories', [storiesStep]),
        grant: { ...grant, step: 'stories' as StepName },
      },
      expected: 'enter',
    },
    {
      name: 'an in-scope grant permits entry to a configured custom DECIDE target',
      input: {
        ...input(customTarget, [customDecideStep]),
        grant: { ...grant, step: customTarget },
      },
      expected: 'enter',
    },
    {
      name: 'interactive plan entry is unaffected by the plan refusal',
      input: { ...input('plan', [decideStep()]), daemon: false, grant },
      expected: 'enter',
    },
    {
      name: 'interactive plan entry needs no grant at all',
      input: { ...input('plan', [decideStep()]), daemon: false },
      expected: 'enter',
    },
    {
      name: 'a grant scoped to a different target halts',
      input: {
        ...input('plan', [decideStep()]),
        grant: { ...grant, step: 'stories' },
      },
      expected: 'halt',
    },
    ...ALL_STEPS
      .filter((step) => step.phase === 'DECIDE')
      .flatMap((step) => [false, 'unknown' as const].map((satisfied) => ({
        name: `unsatisfied ${step.name} (${String(satisfied)}) halts`,
        input: { ...input(step.name, ALL_STEPS), satisfied },
        expected: 'halt',
      }))),
    {
      name: 'an unsatisfied configured DECIDE target halts',
      input: input(customTarget, [customDecideStep]),
      expected: 'halt',
    },
  ];

  expect(cases.map(({ name, input: value }) => ({
    name,
    disposition: summary(decideEntryDisposition(value)),
  }))).toEqual(cases.map(({ name, expected }) => ({ name, disposition: expected })));
});

// ── Grant provenance: the store lives outside every feature worktree ──────────
//
// Regression coverage for 2026-08-09: the grant used to live at
// `<worktree>/.pipeline/decide-grant.json`, inside the directory the build agent
// writes all build long, so the subject of the authorization could write its own
// permission slip. An agent did exactly that and the daemon dispatched `plan`.

it('resolves the grant to the main checkout .daemon store, never the worktree', () => {
  expect(resolveGrantPath('/repo/.worktrees/my-feature')).toBe(
    join('/repo', '.daemon', 'grants', 'my-feature.json'),
  );
});

it('resolves no grant path for a root checkout — interactive runs consult no grant', () => {
  expect(resolveGrantPath('/repo')).toBeNull();
  expect(resolveGrantPath('/repo/some/other/dir')).toBeNull();
});

it('reads nothing from a worktree-local .pipeline grant an agent could write', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grant-provenance-'));
  const worktree = join(root, '.worktrees', 'feat');
  await mkdir(join(worktree, '.pipeline'), { recursive: true });
  await writeFile(
    join(worktree, '.pipeline', 'decide-grant.json'),
    JSON.stringify({ version: 1, step: 'stories', grantedBy: 'operator' }),
    'utf-8',
  );

  // The agent-writable location authorizes nothing.
  expect(await readOperatorGrant(worktree)).toBeNull();

  // Only the daemon-owned store is honored.
  await mkdir(join(root, '.daemon', 'grants'), { recursive: true });
  await writeFile(
    join(root, '.daemon', 'grants', 'feat.json'),
    JSON.stringify({ version: 1, step: 'stories', grantedBy: 'operator' }),
    'utf-8',
  );
  expect(await readOperatorGrant(worktree)).toMatchObject({ step: 'stories' });

  await rm(root, { recursive: true, force: true });
});

it('never consumes a plan grant — it stays as operator-visible evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'grant-plan-'));
  const worktree = join(root, '.worktrees', 'feat');
  await mkdir(join(root, '.daemon', 'grants'), { recursive: true });
  const grantPath = join(root, '.daemon', 'grants', 'feat.json');
  await writeFile(
    grantPath,
    JSON.stringify({ version: 1, step: 'plan', grantedBy: 'operator' }),
    'utf-8',
  );

  expect(await consumeOperatorGrant(worktree, 'plan' as StepName)).toBeNull();
  await expect(readFile(grantPath, 'utf-8')).resolves.toContain('plan');

  await rm(root, { recursive: true, force: true });
});
