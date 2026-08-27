import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { findResumeIndex } from '../../src/engine/conductor.js';
import { readAllVerdicts } from '../../src/engine/gate-verdicts.js';
import { readKickbackLedger } from '../../src/engine/kickback-ledger.js';
import { selectNextGate } from '../../src/engine/selector.js';
import { readState } from '../../src/engine/state.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import { computeTimingRollup } from '../../src/engine/timing-rollup.js';
import type { ConductorEvent } from '../../src/types/events.js';
import type { ConductState } from '../../src/types/state.js';

const FIXTURE_ROOT = join(
  import.meta.dirname,
  '..',
  'fixtures',
  'rebase-invalidated-test-suite-proof-halts-build-review',
);

// Closed historical-fixture list: every path intentionally retaining the retired name.
const HISTORICAL_WIRING_FIXTURE_PATHS = [
  'satisfied-verdict/conduct-state.json',
  'unsatisfied-verdict/conduct-state.json',
  'unsatisfied-verdict/.pipeline/events.jsonl',
  'unsatisfied-verdict/.pipeline/gates/wiring_check.json',
  'unsatisfied-verdict/.pipeline/kickback-ledger.json',
] as const;

describe('historical wiring_check state loadability (Task 9)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'historical-wiring-state-'));
    await cp(join(FIXTURE_ROOT, 'unsatisfied-verdict'), projectRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  it('loads stale state and derives resume position only from the surviving registry', async () => {
    const state = await readState(join(projectRoot, 'conduct-state.json'));

    expect(state).toMatchObject({ ok: true });
    if (!state.ok) return;
    expect(state.value).toMatchObject({
      wiring_check: 'done',
      build_verification__wiring_check: 'done',
      last_step: 'wiring_check',
    });
    expect(ALL_STEPS[findResumeIndex(state.value)]?.name).toBe('finish');
  });

  it('loads a legacy ledger while preserving the surviving test_suite gate', async () => {
    const ledger = await readKickbackLedger(projectRoot);

    expect(ledger.gates).toMatchObject({
      wiring_check: { lastReason: 'legacy wiring verdict' },
      test_suite: { lastReason: 'current suite verdict' },
    });
  });

  it('renders and rolls up raw legacy parallel events without crashing', async () => {
    const raw = await readFile(join(projectRoot, '.pipeline', 'events.jsonl'), 'utf8');
    const rendered: string[] = [];

    for (const line of raw.trim().split('\n')) {
      renderDaemonEvent(JSON.parse(line) as ConductorEvent, (message) => rendered.push(message));
    }

    expect(rendered).toContainEqual(expect.stringContaining('wiring_check'));
    await expect(computeTimingRollup(projectRoot)).resolves.toEqual({
      state: 'measured', activeMs: 250, providerActiveMs: 0, noProviderActiveMs: 250,
    });
  });

  it('ignores an orphan wiring verdict when selecting a gate from the current registry', async () => {
    const verdicts = await readAllVerdicts(projectRoot);
    const state = Object.fromEntries(ALL_STEPS.map(({ name }) => [name, 'done'])) as ConductState;
    const withoutOrphan = Object.fromEntries(
      Object.entries(verdicts).filter(([step]) => step !== 'wiring_check'),
    ) as typeof verdicts;
    const input = { steps: ALL_STEPS, state, regionStart: 'build' as const };

    expect(selectNextGate({ ...input, verdicts })).toEqual(selectNextGate({ ...input, verdicts: withoutOrphan }));
  });
});

void HISTORICAL_WIRING_FIXTURE_PATHS;
