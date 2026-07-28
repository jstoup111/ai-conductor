import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Conductor } from '../../src/engine/conductor.js';
import type { StepRunner } from '../../src/engine/conductor.js';
import { KICKBACK_LEDGER_PATH } from '../../src/engine/kickback-ledger.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

describe('conductor kickback ledger lifecycle (Task 7, #984)', () => {
  let dir: string;
  let statePath: string;
  let ledgerPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'conductor-kickback-ledger-'));
    statePath = join(dir, 'conduct-state.json');
    ledgerPath = join(dir, KICKBACK_LEDGER_PATH);
    await mkdir(join(dir, '.pipeline'), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function firstDispatchSentinel(): StepRunner {
    return {
      run: async () => {
        throw new Error('stop after fresh-session initialization');
      },
    };
  }

  it('clears the kickback ledger when the feature session has not started', async () => {
    await writeFile(ledgerPath, JSON.stringify({ version: 1, gates: {} }), 'utf8');
    await writeFile(statePath, JSON.stringify({}), 'utf8');

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: firstDispatchSentinel(),
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'bootstrap',
    });

    await conductor.run().catch(() => {});

    expect(existsSync(ledgerPath)).toBe(false);
  });

  it('preserves the kickback ledger when the feature session has already started', async () => {
    await writeFile(ledgerPath, JSON.stringify({ version: 1, gates: {} }), 'utf8');
    await writeFile(statePath, JSON.stringify({ run_started_at: 1 }), 'utf8');

    const conductor = new Conductor({
      stateFilePath: statePath,
      stepRunner: firstDispatchSentinel(),
      events: new ConductorEventEmitter(),
      projectRoot: dir,
      config: { max_retries: 1 } as never,
      fromStep: 'bootstrap',
    });

    await conductor.run().catch(() => {});

    expect(existsSync(ledgerPath)).toBe(true);
  });
});
