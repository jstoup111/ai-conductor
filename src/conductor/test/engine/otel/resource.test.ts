/**
 * T7: buildResource(ctx) — OTel Resource builder.
 * FR-6: service.name, conductor.run.id, conductor.feature, conductor.project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { buildResource } from '../../../src/engine/otel/resource.js';

describe('buildResource', () => {
  let tempDir: string;
  let pipelineDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'otel-resource-'));
    pipelineDir = join(tempDir, '.pipeline');
    await mkdir(pipelineDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('resource carries service.name', () => {
    const resource = buildResource({ pipelineDir, feature: 'my-feature', project: 'my-project' });
    const attrs = resource.attributes;
    expect(attrs['service.name']).toBeTruthy();
  });

  it('resource carries conductor.feature', () => {
    const resource = buildResource({ pipelineDir, feature: 'my-feature', project: 'my-project' });
    expect(resource.attributes['conductor.feature']).toBe('my-feature');
  });

  it('resource carries conductor.project', () => {
    const resource = buildResource({ pipelineDir, feature: 'my-feature', project: 'my-project' });
    expect(resource.attributes['conductor.project']).toBe('my-project');
  });

  it('resource carries a non-empty conductor.run.id', () => {
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const runId = resource.attributes['conductor.run.id'];
    expect(typeof runId).toBe('string');
    expect((runId as string).length).toBeGreaterThan(0);
  });

  it('uses conduct-session-id file as run.id when present', async () => {
    const sessionId = 'my-fixed-session-id';
    await writeFile(join(pipelineDir, 'conduct-session-id'), sessionId + '\n', 'utf-8');
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    expect(resource.attributes['conductor.run.id']).toBe(sessionId);
  });

  it('generates a non-empty run.id when conduct-session-id is absent', () => {
    // pipelineDir exists but no session-id file
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const runId = resource.attributes['conductor.run.id'] as string;
    expect(runId).toBeTruthy();
    expect(runId.length).toBeGreaterThan(4);
  });

  it('two builds without session-id file produce distinct run ids', () => {
    const r1 = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const r2 = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    expect(r1.attributes['conductor.run.id']).not.toBe(r2.attributes['conductor.run.id']);
  });

  it('accepts a pre-supplied runId that overrides file/generated', () => {
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p', runId: 'fixed-id' });
    expect(resource.attributes['conductor.run.id']).toBe('fixed-id');
  });

  it('conductor.feature defaults to "unknown" when not supplied', () => {
    const resource = buildResource({ pipelineDir, project: 'p' });
    expect(resource.attributes['conductor.feature']).toBe('unknown');
  });
});
