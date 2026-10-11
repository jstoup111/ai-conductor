import { describe, expect, it } from 'vitest';
import { LogHealth } from '../../../src/engine/otel/log-health.js';
import { ConductorEventEmitter } from '../../../src/ui/events.js';

async function delivered(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe('LogHealth', () => {
  it('reports a sanitized first failure, aggregates all classes once per minute, and bounds recovery', async () => {
    let now = 0;
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    events.on('renderer_error', (event) => { if (event.type === 'renderer_error') warnings.push(event.error); });
    const health = new LogHealth(events, () => now, 'https://logs.example/private/api-key-sentinel/v1/logs');

    health.failure('network');
    for (let index = 0; index < 1_000; index += 1) health.failure(index % 2 === 0 ? 'dropped' : 'timeout');
    await delivered();
    expect(warnings).toEqual(['[otel] log delivery to https://logs.example network; records remain local']);
    expect(warnings.join(' ')).not.toContain('private/api-key-sentinel');

    now = 60_000;
    health.failure('auth', 2);
    await delivered();
    expect(warnings).toEqual([
      '[otel] log delivery to https://logs.example network; records remain local',
      '[otel] log delivery still degraded (network=1, dropped=500, timeout=500, auth=2)',
    ]);

    health.recovered();
    health.failure('response');
    health.recovered();
    await delivered();
    expect(warnings.filter((warning) => warning === '[otel] log delivery recovered')).toHaveLength(1);
  });

  it('does not surface endpoint credentials, raw paths, or malformed input', async () => {
    const events = new ConductorEventEmitter();
    const warnings: string[] = [];
    events.on('renderer_error', (event) => { if (event.type === 'renderer_error') warnings.push(event.error); });
    const health = new LogHealth(events, () => 1, 'https://Authorization:secret@logs.example/sensitive/api-key');

    health.failure('endpoint');
    await delivered();

    expect(warnings).toEqual(['[otel] log delivery to https://logs.example endpoint; records remain local']);
    expect(warnings.join(' ')).not.toMatch(/Authorization|secret|sensitive|api-key/);
  });
});
