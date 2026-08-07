import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConductState, StepName } from '../../src/types/index.js';
import type {
  ConductorOptions,
  StepRunner,
  StepRunResult,
} from '../../src/engine/conductor.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { writeState } from '../../src/engine/state.js';
import { Conductor } from '../test-conductor.js';

export const FEATURE_SLUG = 'decide-entry-fixture';
export const PROVIDER_DISPATCH_SENTINEL = 'acceptance sentinel: stop after observed dispatch';

export interface DecideEntryFixture {
  root: string;
  statePath: string;
  events: ConductorEventEmitter;
}

export async function createDecideEntryFixture(root: string): Promise<DecideEntryFixture> {
  await mkdir(join(root, '.pipeline'), { recursive: true });
  return {
    root,
    statePath: join(root, 'conduct-state.json'),
    events: new ConductorEventEmitter(),
  };
}

export async function cleanupDecideEntryFixture(fixture: DecideEntryFixture): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}

export function resolvedState(
  overrides: Partial<Record<StepName, ConductState[StepName]>> & Partial<ConductState> = {},
): ConductState {
  const state: Record<string, unknown> = {
    feature_desc: FEATURE_SLUG,
    track: 'technical',
    complexity_tier: 'L',
  };
  for (const step of ALL_STEPS) state[step.name] = 'done';
  return { ...state, ...overrides } as ConductState;
}

export function recordingFailureRunner(ran: StepName[]): StepRunner {
  return {
    run: async (step: StepName): Promise<StepRunResult> => {
      ran.push(step);
      return { success: false, output: PROVIDER_DISPATCH_SENTINEL };
    },
  };
}

export function conductorFor(
  fixture: DecideEntryFixture,
  runner: StepRunner,
  options: Partial<ConductorOptions> = {},
): Conductor {
  return new Conductor({
    projectRoot: fixture.root,
    stateFilePath: fixture.statePath,
    events: fixture.events,
    stepRunner: runner,
    mode: 'auto',
    daemon: true,
    verifyArtifacts: true,
    maxRetries: 1,
    escalateBuildFailure: async () => ({}),
    ...options,
  });
}

export async function readOptional(root: string, relativePath: string): Promise<string | null> {
  return readFile(join(root, relativePath), 'utf-8').catch(() => null);
}

export async function pathExists(root: string, relativePath: string): Promise<boolean> {
  return access(join(root, relativePath)).then(() => true).catch(() => false);
}

export async function seedHealthyDecideArtifacts(
  root: string,
  slug = FEATURE_SLUG,
): Promise<void> {
  const files: Array<[string, string]> = [
    [`.docs/track/${slug}.md`, '# Track\n\nTrack: technical\n'],
    [`.docs/complexity/${slug}.md`, '# Complexity\n\nTier: L\n'],
    [`.docs/architecture/${slug}.md`, '# Architecture\n'],
    [
      `.docs/decisions/architecture-review-${slug}.md`,
      '# Architecture Review\n\nStatus: APPROVED\n',
    ],
    [
      `.docs/stories/${slug}.md`,
      '# Stories\n\nStatus: Accepted\n\n## Story 1: healthy flow\n\n### Happy Path\n- Given a complete spec, when it is dispatched, then BUILD is reached.\n\n### Negative Paths\n- Given a missing artifact, when it is dispatched, then the run halts.\n',
    ],
    [`.docs/conflicts/${slug}.md`, '# Conflict Check\n\nVerdict: CLEAN\n'],
    [
      `.docs/plans/${slug}.md`,
      '# Plan\n\n### Task 1: build\n\n**Story:** 1 (happy path, negative path)\n\n**Dependencies:** none\n',
    ],
    [`.docs/coherence/${slug}.md`, '# Coherence\n\n| Row | Verdict |\n|---|---|\n| story-1 | covered |\n'],
  ];
  for (const [relativePath, contents] of files) {
    await mkdir(join(root, relativePath, '..'), { recursive: true });
    await writeFile(join(root, relativePath), contents, 'utf-8');
  }
}

export async function writeFixtureState(
  fixture: DecideEntryFixture,
  state: ConductState,
): Promise<void> {
  await writeState(fixture.statePath, state);
}
