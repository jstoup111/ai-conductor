// Covers: task:1, task:2
/**
 * T7: buildResource(ctx) — OTel Resource builder.
 * FR-6: service.name, conductor.run.id, conductor.feature, conductor.project.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'fs/promises';
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

  it('keeps conductor.run.id stable when telemetry is rebuilt after a process restart', async () => {
    const firstProcess = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const restartedProcess = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const persisted = await readFile(join(pipelineDir, 'conduct-session-id'), 'utf-8');

    expect({
      firstProcess: firstProcess.attributes['conductor.run.id'],
      restartedProcess: restartedProcess.attributes['conductor.run.id'],
      persisted,
    }).toEqual({
      firstProcess: persisted,
      restartedProcess: persisted,
      persisted,
    });
  });

  it('generates a non-empty run.id when conduct-session-id is absent', () => {
    // pipelineDir exists but no session-id file
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const runId = resource.attributes['conductor.run.id'] as string;
    expect(runId).toBeTruthy();
    expect(runId.length).toBeGreaterThan(4);
  });

  it('two builds without an initial session-id file share the newly persisted run id', () => {
    const r1 = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    const r2 = buildResource({ pipelineDir, feature: 'f', project: 'p' });
    expect(r1.attributes['conductor.run.id']).toBe(r2.attributes['conductor.run.id']);
  });

  it('accepts a pre-supplied runId that overrides file/generated', () => {
    const resource = buildResource({ pipelineDir, feature: 'f', project: 'p', runId: 'fixed-id' });
    expect(resource.attributes['conductor.run.id']).toBe('fixed-id');
  });

  it('uses the resolved project and feature as service.instance.id while retaining resource attributes', async () => {
    const configured = buildResource({
      pipelineDir,
      feature: 'explicit-feature',
      project: '/workspace/explicit-project',
      projectName: 'configured-project',
      runId: 'explicit-run-id',
    });
    await writeFile(join(pipelineDir, 'conduct-session-id'), 'persisted-run-id\n', 'utf-8');
    const basename = buildResource({
      pipelineDir,
      feature: 'persisted-feature',
      project: '/workspace/persisted-project',
      projectName: 'persisted-project',
    });
    const missingProjectName = buildResource({ pipelineDir, feature: 'f', project: 'p', runId: 'run-1' });
    const missingFeature = buildResource({
      pipelineDir,
      project: 'p',
      projectName: 'resolved-project',
      runId: 'run-2',
    });

    expect([
      configured.attributes,
      basename.attributes,
      missingProjectName.attributes,
      missingFeature.attributes,
    ]).toEqual([
      {
        'service.name': 'ai-conductor',
        'service.instance.id': 'configured-project/explicit-feature',
        'conductor.run.id': 'explicit-run-id',
        'conductor.feature': 'explicit-feature',
        'conductor.project': '/workspace/explicit-project',
        'conductor.branch': 'not-supplied',
        'conductor.engine.version': 'not-supplied',
      },
      {
        'service.name': 'ai-conductor',
        'service.instance.id': 'persisted-project/persisted-feature',
        'conductor.run.id': 'persisted-run-id',
        'conductor.feature': 'persisted-feature',
        'conductor.project': '/workspace/persisted-project',
        'conductor.branch': 'not-supplied',
        'conductor.engine.version': 'not-supplied',
      },
      {
        'service.name': 'ai-conductor',
        'service.instance.id': 'unknown/f',
        'conductor.run.id': 'run-1',
        'conductor.feature': 'f',
        'conductor.project': 'p',
        'conductor.branch': 'not-supplied',
        'conductor.engine.version': 'not-supplied',
      },
      {
        'service.name': 'ai-conductor',
        'service.instance.id': 'resolved-project/unknown',
        'conductor.run.id': 'run-2',
        'conductor.feature': 'unknown',
        'conductor.project': 'p',
        'conductor.branch': 'not-supplied',
        'conductor.engine.version': 'not-supplied',
      },
    ]);
  });

  it('pinning: never throws for an unwritable pipeline path and retains the composed instance id', async () => {
    const unusablePipelineDir = join(tempDir, 'not-a-directory');
    await writeFile(unusablePipelineDir, 'not a directory', 'utf-8');

    let resource: ReturnType<typeof buildResource>;
    expect(() => {
      resource = buildResource({
        pipelineDir: unusablePipelineDir,
        feature: 'feature-a',
        project: '/workspace/project-a',
        projectName: 'project-a',
      });
    }).not.toThrow();

    expect(resource!.attributes['service.instance.id']).toBe('project-a/feature-a');
    expect(resource!.attributes['conductor.run.id']).toMatch(/\S/);
  });

  it('pinning: mints a run id for a whitespace-only session id without changing the composed instance id', async () => {
    await writeFile(join(pipelineDir, 'conduct-session-id'), '  \n\t ', 'utf-8');

    const resource = buildResource({
      pipelineDir,
      feature: 'feature-b',
      project: '/workspace/project-b',
      projectName: 'project-b',
    });
    const runId = resource.attributes['conductor.run.id'] as string;

    expect(runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(resource.attributes['service.instance.id']).toBe('project-b/feature-b');
    expect(resource.attributes['service.instance.id']).not.toContain(runId);
  });

  it('conductor.feature defaults to "unknown" when not supplied', () => {
    const resource = buildResource({ pipelineDir, project: 'p' });
    expect(resource.attributes['conductor.feature']).toBe('unknown');
  });

  describe('scoped identity resolution', () => {
    it('distinguishes resolved, explicit-unresolved, and omitted branch and engine identity without throwing', () => {
      const resolved = { pipelineDir, branch: 'feat/resolved', engineVersion: 'v1' };
      const unresolved = { pipelineDir, branch: undefined, engineVersion: undefined };
      const omitted = { pipelineDir };

      expect(() => buildResource(resolved, 'traces')).not.toThrow();
      expect(() => buildResource(unresolved, 'traces')).not.toThrow();
      expect(() => buildResource(omitted, 'traces')).not.toThrow();

      expect(buildResource(resolved, 'traces').attributes).toMatchObject({
        'conductor.branch': 'feat/resolved',
        'conductor.engine.version': 'v1',
      });
      expect(buildResource(unresolved, 'traces').attributes).toMatchObject({
        'conductor.branch': 'unresolved',
        'conductor.engine.version': 'unresolved',
      });
      expect(buildResource(omitted, 'traces').attributes).toMatchObject({
        'conductor.branch': 'not-supplied',
        'conductor.engine.version': 'not-supplied',
      });
      expect(buildResource(unresolved, 'metrics').attributes['conductor.branch']).toBe('unresolved');
      expect(buildResource(omitted, 'metrics').attributes['conductor.branch']).toBe('not-supplied');
      expect(buildResource(unresolved, 'metrics').attributes['conductor.engine.version']).toBeUndefined();
      expect(buildResource(omitted, 'metrics').attributes['conductor.engine.version']).toBeUndefined();
    });
  });

  // Story 2: the metric Resource is feature-stable. Prometheus folds the whole
  // resource attribute set into `target_info`'s label set, so a run-varying
  // attribute here mints a series per run exactly as a data-point attribute
  // would. The trace Resource has no such constraint.
  describe('signal scope', () => {
    const ctx = () => ({
      pipelineDir,
      feature: 'feature-a',
      project: '/workspace/project-a',
      projectName: 'project-a',
      branch: 'feat/thing',
      engineVersion: '20260828T000000Z-abc',
      runId: 'run-1',
    });

    it('the metric scope carries exactly the feature-stable attribute set', () => {
      const resource = buildResource(ctx(), 'metrics');

      // Exact set, not a subset: an added run-varying attribute must fail here.
      expect(Object.keys(resource.attributes).sort()).toEqual([
        'conductor.branch',
        'conductor.feature',
        'conductor.project',
        'service.instance.id',
        'service.name',
      ]);
    });

    it('the trace scope adds the run id and the engine version', () => {
      const resource = buildResource(ctx(), 'traces');

      expect(resource.attributes['conductor.run.id']).toBe('run-1');
      expect(resource.attributes['conductor.engine.version']).toBe('20260828T000000Z-abc');
    });

    it('both scopes carry the same service.instance.id and service.name', () => {
      const metrics = buildResource(ctx(), 'metrics');
      const traces = buildResource(ctx(), 'traces');

      expect(metrics.attributes['service.instance.id']).toBe('project-a/feature-a');
      expect(traces.attributes['service.instance.id']).toBe(metrics.attributes['service.instance.id']);
      expect(metrics.attributes['service.name']).toBe('ai-conductor');
      expect(traces.attributes['service.name']).toBe('ai-conductor');
    });

    it('the metric scope omits the run id even when a session file supplies one', async () => {
      await writeFile(join(pipelineDir, 'conduct-session-id'), 'session-run-id', 'utf-8');
      const { runId: _drop, ...withoutOverride } = ctx();

      const resource = buildResource(withoutOverride, 'metrics');

      expect(Object.values(resource.attributes)).not.toContain('session-run-id');
      expect(resource.attributes['conductor.run.id']).toBeUndefined();
    });

    it('two engine versions yield an identical metric attribute set, so target_info gains no series', () => {
      const first = buildResource({ ...ctx(), engineVersion: 'v1' }, 'metrics');
      const second = buildResource({ ...ctx(), engineVersion: 'v2' }, 'metrics');

      expect(first.attributes).toEqual(second.attributes);
    });

    it('an unwritable pipeline directory still builds both scopes without throwing', () => {
      const unwritable = join(tempDir, 'no', 'such', 'dir');
      const broken = { ...ctx(), pipelineDir: unwritable, runId: undefined };

      expect(() => buildResource(broken, 'metrics')).not.toThrow();
      expect(() => buildResource(broken, 'traces')).not.toThrow();
      expect(buildResource(broken, 'metrics').attributes['service.instance.id']).toBe('project-a/feature-a');
    });
  });
});
