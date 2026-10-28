import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { CloseoutEventTail } from '../src/engine/closeout-tail.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
async function project(): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'closeout-tail-')); directories.push(root); await mkdir(join(root, '.pipeline'), { recursive: true }); return root; }
const verdict = { type: 'build_review_outer_verdict', lapId: 'lap-1', rawVerdict: 'PASS', effectiveVerdict: 'PASS', ts: '2026-10-01T00:00:00.000Z' } as const;
const authorization = { type: 'kickback_budget_adjustment_authorized', adjustmentId: 'adj-1', gate: 'build_review', kind: 'raise', feature: 'feature', operator: 'operator', rationale: 'evidence', beforeConsumed: 1, afterConsumed: 1, beforeLimit: 5, afterLimit: 6, ts: '2026-10-01T00:00:01.000Z' } as const;

describe('CloseoutEventTail', () => {
  it('re-emits admitted records in ledger order exactly once', async () => {
    const root = await project();
    await writeFile(join(root, '.pipeline/pipeline-events.jsonl'), `${JSON.stringify(verdict)}\n${JSON.stringify(authorization)}\n`);
    const events = new ConductorEventEmitter(); const received: unknown[] = [];
    events.on('build_review_outer_verdict', (event) => { received.push(event); });
    events.on('kickback_budget_adjustment_authorized', (event) => { received.push(event); });
    const tail = new CloseoutEventTail({ projectRoot: root, events });
    await tail.poll(); await tail.poll();
    expect(received).toEqual([verdict, authorization]);
  });

  it('diagnoses each unadmitted record and continues to a following admitted record', async () => {
    const root = await project();
    const retired = { type: 'pipeline_closeout', obligation: 'evaluator', startedAt: 1, endedAt: 2, ts: 2 };
    await writeFile(join(root, '.pipeline/pipeline-events.jsonl'), `${JSON.stringify(retired)}\n${JSON.stringify(verdict)}\n`);
    const events = new ConductorEventEmitter(); const diagnostics: unknown[] = []; const received: unknown[] = [];
    events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); });
    events.on('build_review_outer_verdict', (event) => { received.push(event); });
    const tail = new CloseoutEventTail({ projectRoot: root, events }); await tail.poll(); await tail.poll();
    expect(diagnostics).toEqual([{ type: 'pipeline_tail_diagnostic', reason: 'unadmitted-type', path: '.pipeline/pipeline-events.jsonl', byteOffset: 0 }]);
    expect(received).toEqual([verdict]);
  });

  it('diagnoses an engine record once without re-emitting it', async () => {
    const root = await project();
    await writeFile(join(root, '.pipeline/pipeline-events.jsonl'), `${JSON.stringify({ type: 'step_started', step: 'build', index: 1 })}\n`);
    const events = new ConductorEventEmitter(); const diagnostics: unknown[] = []; const received: unknown[] = [];
    events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); });
    events.on('step_started', (event) => { received.push(event); });
    const tail = new CloseoutEventTail({ projectRoot: root, events }); await tail.poll(); await tail.poll();
    expect(diagnostics).toEqual([{ type: 'pipeline_tail_diagnostic', reason: 'unadmitted-type', path: '.pipeline/pipeline-events.jsonl', byteOffset: 0 }]);
    expect(received).toEqual([]);
  });

  it('diagnoses a malformed line while continuing', async () => {
    const root = await project(); await writeFile(join(root, '.pipeline/pipeline-events.jsonl'), `{not-json}\n${JSON.stringify(verdict)}\n`);
    const events = new ConductorEventEmitter(); const diagnostics: unknown[] = []; const received: unknown[] = [];
    events.on('pipeline_tail_diagnostic', (event) => { diagnostics.push(event); }); events.on('build_review_outer_verdict', (event) => { received.push(event); });
    await new CloseoutEventTail({ projectRoot: root, events }).poll();
    expect(diagnostics).toEqual([{ type: 'pipeline_tail_diagnostic', reason: 'malformed-line', path: '.pipeline/pipeline-events.jsonl', byteOffset: 0 }]);
    expect(received).toEqual([verdict]);
  });
});
