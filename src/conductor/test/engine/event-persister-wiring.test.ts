// Covers: task:16, task:8
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  startDaemonEventPersistence,
  startFeatureEventPersistence,
} from '../../src/engine/event-persister.js';
import { renderDaemonEvent } from '../../src/daemon-cli.js';
import { renderReport } from '../../src/engine/report-renderer.js';
import { MetricsListener } from '../../src/engine/otel/metrics-listener.js';
import { TerminalRenderer } from '../../src/ui/terminal-renderer.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { ALL_STEPS } from '../../src/engine/steps.js';
import type { ConductorEvent, ConductState } from '../../src/types/index.js';
import type { MetricsRecorder } from '../../src/engine/otel/metrics.js';
import type { LiveRegion } from '../../src/ui/live-region.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '..', '..', 'src');

/**
 * Task 8: EventPersister MUST be wired only in index.ts — zero references in
 * conductor.ts or step-runners.ts.
 */
describe('EventPersister wiring constraints', () => {
  it('conductor.ts has zero EventPersister references', () => {
    const conductorSrc = readFileSync(join(srcRoot, 'engine', 'conductor.ts'), 'utf-8');
    expect(conductorSrc).not.toContain('EventPersister');
  });

  it('step-runners.ts has zero EventPersister references', () => {
    const stepRunnersSrc = readFileSync(join(srcRoot, 'engine', 'step-runners.ts'), 'utf-8');
    expect(stepRunnersSrc).not.toContain('EventPersister');
  });

  it('index.ts imports EventPersister', () => {
    const indexSrc = readFileSync(join(srcRoot, 'index.ts'), 'utf-8');
    expect(indexSrc).toContain('EventPersister');
  });

  it('forwards interleaved configured-member contexts to one daemon projection and renders them without duplicating the feature ledger', async () => {
    const root = await mkdtemp(join(process.env.TMPDIR ?? process.env.TEMP ?? '/tmp', 'task-16-forwarding-'));
    const daemonEvents = new ConductorEventEmitter();
    const daemonPersistence = startDaemonEventPersistence(root, daemonEvents);
    const alpha = startFeatureEventPersistence(join(root, 'alpha'), daemonEvents, 'alpha');
    const beta = startFeatureEventPersistence(join(root, 'beta'), daemonEvents, 'beta');
    const recorded = new Map<string, { onStepClose: ReturnType<typeof vi.fn>; onStepTerminal: ReturnType<typeof vi.fn> }>();
    const recorder = {
      forFeature: (feature: string) => {
        let metric = recorded.get(feature);
        if (!metric) {
          metric = { onStepClose: vi.fn(), onStepTerminal: vi.fn() };
          recorded.set(feature, metric);
        }
        return metric;
      },
    } as unknown as MetricsRecorder;
    const metrics = new MetricsListener(recorder, () => 1_000);
    metrics.start(daemonEvents);
    const alphaContext = {
      executionId: 'same-execution-id',
      subject: { kind: 'configured-member' as const, parentGroup: 'quality', member: 'audit' },
    };
    const betaContext = {
      executionId: 'same-execution-id',
      subject: { kind: 'configured-member' as const, parentGroup: 'security', member: 'audit' },
    };

    try {
      // A failing OTel projection is best-effort: it must not alter forwarding
      // or the one-feature-ledger policy.
      daemonEvents.on('step_completed', () => { throw new Error('fake exporter failed'); });

      await alpha.events.emit({ type: 'step_started', step: 'build', index: 0, executionContext: alphaContext });
      await beta.events.emit({ type: 'step_started', step: 'build', index: 0, executionContext: betaContext });
      await alpha.events.emit({
        type: 'step_refused', step: 'build', kind: 'validation-verdict',
        reason: 'quality gate refused', executionContext: alphaContext,
      });
      await beta.events.emit({ type: 'step_completed', step: 'build', status: 'done', executionContext: betaContext });

      expect(recorded.get('alpha')?.onStepTerminal).toHaveBeenCalledWith(
        'configured:quality/audit', 'refusal', {},
      );
      expect(recorded.get('beta')?.onStepTerminal).toHaveBeenCalledWith(
        'configured:security/audit', 'success', {},
      );

      const [alphaLedger, betaLedger] = await Promise.all([
        readFile(join(root, 'alpha', '.pipeline', 'events.jsonl'), 'utf8'),
        readFile(join(root, 'beta', '.pipeline', 'events.jsonl'), 'utf8'),
      ]);
      expect(alphaLedger).toContain('same-execution-id');
      expect(betaLedger).toContain('same-execution-id');
      await expect(readFile(join(root, '.daemon', 'events.jsonl'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });

      const rendered: string[] = [];
      renderDaemonEvent({
        type: 'step_refused', step: 'build', kind: 'validation-verdict',
        reason: 'quality gate refused', executionContext: alphaContext,
      }, (line) => rendered.push(line));
      expect(rendered.join('\n')).toContain('configured:quality/audit refused');

      const terminalLines: string[] = [];
      const renderer = new TerminalRenderer({
        stateFilePath: join(root, 'state.json'),
        steps: ALL_STEPS,
        readStateFn: async () => ({ ok: true, value: {} as ConductState }),
        liveRegion: {
          update: () => {}, clear: () => {}, suspend: () => {}, resume: () => {},
          log: (line: string) => terminalLines.push(line),
        } as LiveRegion,
      });
      await renderer.handle({ type: 'step_started', step: 'build', index: 0, executionContext: alphaContext });
      await renderer.handle({
        type: 'step_refused', step: 'build', kind: 'validation-verdict',
        reason: 'quality gate refused', executionContext: alphaContext,
      });
      expect(terminalLines.join('\n')).toContain('configured:quality/audit');
      expect(terminalLines.join('\n')).toContain('STEP REFUSED');

      const report = renderReport(join(root, 'alpha', '.pipeline', 'events.jsonl'));
      expect(report).toContain('configured:quality/audit');
      expect(report).toContain('(refused)');
    } finally {
      metrics.stop();
      alpha.stop();
      beta.stop();
      daemonPersistence.stop();
      await rm(root, { recursive: true, force: true });
    }
  });
});
