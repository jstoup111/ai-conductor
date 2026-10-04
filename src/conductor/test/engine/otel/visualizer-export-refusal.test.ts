// Covers: task:7
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wireOtelVisualizer } from '../../../src/engine/otel/wire.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

describe('OTel visualizer export refusal', () => {
  it('converts a refused exporter into one renderer error and leaves later events usable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'otel-visualizer-refusal-'));
    const events = new ConductorEventEmitter();
    const errors: string[] = [];
    events.on('renderer_error', (event) => { if ('error' in event) errors.push(event.error); });
    try {
      const visualizer = wireOtelVisualizer({ otel: { exporter: 'otlp', endpoint: 'http://127.0.0.1:1', spool: { enabled: false } } }, {
        pipelineDir: join(root, '.pipeline'), runId: 'run', feature: 'feature', project: root,
        branch: 'feature', engineVersion: 'test', harnessVersion: 'test', env: { AI_CONDUCTOR_NO_REAL_EXEC: '1' },
      }, events);
      await Promise.resolve();
      await expect(events.emit({ type: 'step_started', step: 'build', index: 1 })).resolves.toBeUndefined();
      expect(visualizer).toBeNull();
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('AI_CONDUCTOR_NO_REAL_EXEC');
      expect(errors[0]).toContain('AI_CONDUCTOR_OTEL_SMOKE');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
