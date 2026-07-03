// conductor-owner-stamp.test.ts — Story 3 (Slice B): the plain `/conduct`
// DECIDE tail stamps the SAME owner marker the `/engineer` path does
// (adr-2026-07-01-machine-scoped-operator-identity, D4).
//
// Today there is NO marker writer on the conduct path at all (only parsers —
// the #189/#190 backfill proved the gap). This drives the REAL conductor
// `plan` step's completion (the point where the `.docs/plans/<stem>.md`
// artifact gate passes), NOT a direct call to `writeIntakeMarker`, and asserts
// the committed `.docs/intake/<stem>.md` observable artifact — keyed by the
// exact plan-file stem `daemon-backlog.ts` resolves (`basename(file, '.md')`).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { ConductorEventEmitter } from '../../src/ui/events.js';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner, StepName } from '../../src/engine/conductor.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';
import { writeState } from '../../src/engine/state.js';
import type { ConductState } from '../../src/types/index.js';

const PLAN_STEM = 'my-feature';
const PLAN_BODY = [
  '# Implementation Plan: My Feature',
  '',
  '## Task Dependency Graph',
  '```',
  '1',
  '```',
  '',
].join('\n');

let dir: string;
let statePath: string;
let events: ConductorEventEmitter;

/**
 * A StepRunner that writes the `.docs/plans/<PLAN_STEM>.md` artifact when the
 * `plan` step runs (simulating the real /plan skill's output) and succeeds
 * for every other step, so the run reaches (and passes) the plan artifact
 * gate deterministically.
 */
function makePlanWritingRunner(): StepRunner {
  return {
    run: async (step: StepName) => {
      if (step === 'plan') {
        await mkdir(join(dir, '.docs', 'plans'), { recursive: true });
        await writeFile(join(dir, '.docs', 'plans', `${PLAN_STEM}.md`), PLAN_BODY, 'utf-8');
      }
      return { success: true };
    },
  };
}

/** Create an isolated fake $HOME carrying `~/.ai-conductor/config.yml` (or no
 *  config file at all when `body` is omitted). */
async function makeUserHome(body?: string): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'user-home-'));
  if (body !== undefined) {
    await mkdir(join(home, '.ai-conductor'), { recursive: true });
    await writeFile(join(home, '.ai-conductor', 'config.yml'), body, 'utf-8');
  }
  return home;
}

async function withHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    process.env.HOME = saved;
  }
}

/** gh runner that never resolves a login (simulates unauthenticated/uninjected gh). */
const failingGh: GhRunner = async () => {
  throw new Error('gh: not logged in');
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'conductor-owner-stamp-'));
  statePath = join(dir, 'conduct-state.json');
  events = new ConductorEventEmitter();
});

/**
 * Seed just enough state for `fromStep: 'plan'` to actually DISPATCH the
 * `plan` step: `checkGate` only checks `plan`'s immediate prerequisite
 * (`conflict_check`) via `stepSatisfied` — it does NOT walk the whole
 * upstream chain — so marking `conflict_check` done/skipped is sufficient.
 * Without this, the run short-circuits at the very first `gate_blocked`
 * ("Prerequisites not satisfied: conflict_check") before `plan` ever runs,
 * which would make every assertion below RED for the WRONG reason.
 */
async function seedPlanReachableState(): Promise<void> {
  await writeState(statePath, { conflict_check: 'done' } as ConductState);
}

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('conduct DECIDE tail stamps the owner marker at plan-step completion (Slice B Story 3, D4)', () => {
  it('Task 11: plan artifact gate passes + resolved machine identity → .docs/intake/<plan-stem>.md exists with Owner: <id>', async () => {
    const fakeHome = await makeUserHome('spec_owner: bob\n');
    await withHome(fakeHome, async () => {
      await seedPlanReachableState();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: makePlanWritingRunner(),
        events,
        projectRoot: dir,
        fromStep: 'plan',
        // Forward-looking seam (Task 12 GREEN wiring): a gh runner threaded the
        // same way engineer-cli.ts does. Present-day conductor.ts reads nothing
        // from this field yet — that absence IS this test's RED.
        gh: (async () => ({ stdout: '' })) as unknown as GhRunner,
      } as ConstructorParameters<typeof Conductor>[0]);

      await conductor.run();

      const markerPath = join(dir, '.docs', 'intake', `${PLAN_STEM}.md`);
      expect(existsSync(markerPath)).toBe(true);
      const body = await readFile(markerPath, 'utf-8');
      expect(body).toContain('Owner: bob');
    });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('Task 11 (negative keying): the marker path equals .docs/intake/<exact-plan-stem>.md, not the raw idea slug', async () => {
    const fakeHome = await makeUserHome('spec_owner: bob\n');
    await withHome(fakeHome, async () => {
      await seedPlanReachableState();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: makePlanWritingRunner(),
        events,
        projectRoot: dir,
        fromStep: 'plan',
        featureDesc: 'a completely different idea slug',
      });

      await conductor.run();

      // Marker MUST be keyed by the plan file's stem (`my-feature`), the same
      // stem daemon-backlog.ts resolves via basename(file, '.md') — never by
      // `featureDesc` or any other idea-slug-derived name.
      expect(existsSync(join(dir, '.docs', 'intake', `${PLAN_STEM}.md`))).toBe(true);
      expect(existsSync(join(dir, '.docs', 'intake', 'a-completely-different-idea-slug.md'))).toBe(
        false,
      );
    });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('Task 13a: an existing Source-Ref: line survives owner stamping', async () => {
    // Pre-seed .docs/intake/<stem>.md with an engineer-intake-origin Source-Ref
    // BEFORE the plan-step completion fires (e.g. this spec started life as a
    // routed github-issues idea, then continued on the plain /conduct path).
    await mkdir(join(dir, '.docs', 'intake'), { recursive: true });
    await writeFile(
      join(dir, '.docs', 'intake', `${PLAN_STEM}.md`),
      `# Intake origin: ${PLAN_STEM}\n\nSource-Ref: owner/repo#7\n`,
      'utf-8',
    );

    const fakeHome = await makeUserHome('spec_owner: bob\n');
    await withHome(fakeHome, async () => {
      await seedPlanReachableState();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: makePlanWritingRunner(),
        events,
        projectRoot: dir,
        fromStep: 'plan',
      });

      await conductor.run();

      const body = await readFile(join(dir, '.docs', 'intake', `${PLAN_STEM}.md`), 'utf-8');
      expect(body).toContain('Source-Ref: owner/repo#7'); // preserved
      expect(body).toContain('Owner: bob'); // newly stamped
    });
    await rm(fakeHome, { recursive: true, force: true });
  });

  it('Task 13b: unresolved identity on the conduct path refuses loudly, writing NO marker at all', async () => {
    const fakeHome = await makeUserHome(); // no ~/.ai-conductor/config.yml
    await withHome(fakeHome, async () => {
      const blockedReasons: string[] = [];
      events.on('gate_blocked', (e) => {
        if (e.type === 'gate_blocked') blockedReasons.push(e.reason);
      });
      events.on('step_failed', (e) => {
        if (e.type === 'step_failed') blockedReasons.push(e.error);
      });
      events.on('loop_halt', (e) => {
        if (e.type === 'loop_halt') blockedReasons.push(e.reason);
      });

      await seedPlanReachableState();
      const conductor = new Conductor({
        stateFilePath: statePath,
        stepRunner: makePlanWritingRunner(),
        events,
        projectRoot: dir,
        fromStep: 'plan',
        gh: failingGh as unknown as GhRunner,
      } as ConstructorParameters<typeof Conductor>[0]);

      let caught: Error | null = null;
      try {
        await conductor.run();
      } catch (e) {
        caught = e instanceof Error ? e : new Error(String(e));
      }

      // No marker written on the unresolved-identity path — no Owner-less
      // marker, no silent skip (same fail-closed rule + error text as Story 2).
      expect(existsSync(join(dir, '.docs', 'intake', `${PLAN_STEM}.md`))).toBe(false);

      // The refusal must be LOUD: either a thrown error or an emitted
      // gate_blocked/step_failed/loop_halt event names both remediation paths.
      const combined = [caught?.message ?? '', ...blockedReasons].join('\n');
      expect(combined).toMatch(/~\/\.ai-conductor\/config\.yml/);
      expect(combined).toMatch(/gh auth login/);
    });
    await rm(fakeHome, { recursive: true, force: true });
  });
});
