import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  resolveFeaturePaths,
  resolveRootPaths,
  rootPipelineDir,
  projectStatePath,
  featurePipelineDir,
} from '../../src/engine/feature-paths.js';
import {
  readProjectState,
  writeProjectState,
  patchProjectState,
} from '../../src/engine/project-state.js';
import { migrateLegacyPipelineLayout } from '../../src/engine/legacy-migration.js';
import { detectAutoResume } from '../../src/engine/auto-resume.js';
import { scanResumableFeatures } from '../../src/engine/resume.js';
import { writeState, readState } from '../../src/engine/state.js';

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('engine/feature-paths', () => {
  it('resolves feature-scoped pipeline paths under .pipeline/features/<slug>/', () => {
    const root = '/tmp/proj';
    const paths = resolveFeaturePaths(root, 'Add user login');

    expect(paths.pipelineDir).toBe('/tmp/proj/.pipeline/features/add-user-login');
    expect(paths.stateFilePath).toBe(
      '/tmp/proj/.pipeline/features/add-user-login/conduct-state.json',
    );
    expect(paths.sessionIdPath).toBe(
      '/tmp/proj/.pipeline/features/add-user-login/conduct-session-id',
    );
    expect(paths.eventsLogPath).toBe(
      '/tmp/proj/.pipeline/features/add-user-login/events.jsonl',
    );
  });

  it('resolves root pipeline paths when no feature is in scope', () => {
    const paths = resolveRootPaths('/tmp/proj');
    expect(paths.pipelineDir).toBe('/tmp/proj/.pipeline');
    expect(paths.stateFilePath).toBe('/tmp/proj/.pipeline/conduct-state.json');
  });

  it('keys two distinct features into separate directories', () => {
    const a = resolveFeaturePaths('/tmp/proj', 'Feature Alpha');
    const b = resolveFeaturePaths('/tmp/proj', 'Feature Beta');
    expect(a.pipelineDir).not.toBe(b.pipelineDir);
    expect(a.stateFilePath).not.toBe(b.stateFilePath);
    expect(a.sessionIdPath).not.toBe(b.sessionIdPath);
  });

  it('exposes rootPipelineDir / projectStatePath / featurePipelineDir helpers', () => {
    expect(rootPipelineDir('/r')).toBe('/r/.pipeline');
    expect(projectStatePath('/r')).toBe('/r/.pipeline/project-state.json');
    expect(featurePipelineDir('/r', 'slug')).toBe('/r/.pipeline/features/slug');
  });
});

describe('engine/project-state', () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'project-state-test-'));
    path = join(dir, 'project-state.json');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns {} for missing files', async () => {
    const state = await readProjectState(path);
    expect(state).toEqual({});
  });

  it('round-trips bootstrap_mode through write/read', async () => {
    await writeProjectState(path, { bootstrap_mode: 'fresh' });
    const state = await readProjectState(path);
    expect(state.bootstrap_mode).toBe('fresh');
  });

  it('patchProjectState merges instead of overwriting', async () => {
    await writeProjectState(path, { bootstrap_mode: 'new' });
    const next = await patchProjectState(path, {});
    expect(next.bootstrap_mode).toBe('new');
  });

  it('treats corrupted JSON as empty (forgiving)', async () => {
    await writeFile(path, '{not json', 'utf-8');
    const state = await readProjectState(path);
    expect(state).toEqual({});
  });
});

describe('engine/auto-resume: feature-scoped state takes precedence', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'auto-resume-iso-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('finds feature state in .pipeline/features/<slug>/conduct-state.json', async () => {
    const featureDesc = 'Build OAuth flow';
    const paths = resolveFeaturePaths(dir, featureDesc);
    await mkdir(paths.pipelineDir, { recursive: true });
    await writeState(paths.stateFilePath, {
      feature_desc: featureDesc,
      brainstorm: 'done',
      last_step: 'brainstorm',
    });

    const result = await detectAutoResume(dir, featureDesc);
    expect(result.kind).toBe('resume');
    if (result.kind === 'resume') {
      expect(result.featureDesc).toBe(featureDesc);
      expect(result.lastStep).toBe('brainstorm');
      expect(result.stateFilePath).toBe(paths.stateFilePath);
    }
  });

  it('does NOT pick up another feature state stored under a different slug', async () => {
    // Feature A has been started — its state lives under feature-a/.
    const aPaths = resolveFeaturePaths(dir, 'Feature A');
    await mkdir(aPaths.pipelineDir, { recursive: true });
    await writeState(aPaths.stateFilePath, {
      feature_desc: 'Feature A',
      brainstorm: 'done',
      stories: 'done',
      plan: 'done',
      last_step: 'plan',
    });

    // Now ask the system to start Feature B (no state exists for it).
    const result = await detectAutoResume(dir, 'Feature B');
    expect(result.kind).toBe('none');
  });

  it('returns kind=none for a fresh feature even when a different feature has done steps', async () => {
    // Reproduces the original bug: starting a new feature should not
    // inherit "done" step keys from another feature.
    const aPaths = resolveFeaturePaths(dir, 'first feature');
    await mkdir(aPaths.pipelineDir, { recursive: true });
    await writeState(aPaths.stateFilePath, {
      feature_desc: 'first feature',
      brainstorm: 'done',
      stories: 'done',
      plan: 'done',
      acceptance_specs: 'done',
      build: 'done',
      manual_test: 'done',
      retro: 'done',
      finish: 'done',
      feature_status: 'complete',
    });

    const result = await detectAutoResume(dir, 'second feature');
    expect(result.kind).toBe('none');
  });
});

describe('engine/resume: scanner surfaces feature-scoped state', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'resume-scan-iso-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists features that have feature-scoped state but no worktree yet', async () => {
    const aPaths = resolveFeaturePaths(dir, 'Feature Alpha');
    const bPaths = resolveFeaturePaths(dir, 'Feature Beta');
    await mkdir(aPaths.pipelineDir, { recursive: true });
    await mkdir(bPaths.pipelineDir, { recursive: true });
    await writeState(aPaths.stateFilePath, {
      feature_desc: 'Feature Alpha',
      last_step: 'brainstorm',
    });
    await writeState(bPaths.stateFilePath, {
      feature_desc: 'Feature Beta',
      last_step: 'plan',
    });

    const features = await scanResumableFeatures(dir);
    const slugs = features.map((f) => f.name).sort();
    expect(slugs).toEqual(['feature-alpha', 'feature-beta']);
  });

  it('skips features whose feature-scoped state is marked complete', async () => {
    const aPaths = resolveFeaturePaths(dir, 'Already Done');
    await mkdir(aPaths.pipelineDir, { recursive: true });
    await writeState(aPaths.stateFilePath, {
      feature_desc: 'Already Done',
      feature_status: 'complete',
    });
    const features = await scanResumableFeatures(dir);
    expect(features).toEqual([]);
  });
});

describe('engine/legacy-migration', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'legacy-migration-'));
    await mkdir(rootPipelineDir(dir), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('moves legacy state into .pipeline/features/<slug>/', async () => {
    const legacyState = join(dir, '.pipeline', 'conduct-state.json');
    const legacySession = join(dir, '.pipeline', 'conduct-session-id');
    const legacyEvents = join(dir, '.pipeline', 'events.jsonl');
    await writeState(legacyState, {
      feature_desc: 'Legacy Feature',
      brainstorm: 'done',
      last_step: 'brainstorm',
    });
    await writeFile(legacySession, 'old-session-id', 'utf-8');
    await writeFile(legacyEvents, '{"type":"step_started"}\n', 'utf-8');

    const result = await migrateLegacyPipelineLayout(dir);

    expect(result.ran).toBe(true);
    expect(result.slug).toBe('legacy-feature');

    // Old paths gone.
    expect(await fileExists(legacyState)).toBe(false);
    expect(await fileExists(legacySession)).toBe(false);
    expect(await fileExists(legacyEvents)).toBe(false);

    // New paths populated.
    const newPaths = resolveFeaturePaths(dir, 'Legacy Feature');
    expect(await fileExists(newPaths.stateFilePath)).toBe(true);
    expect(await fileExists(newPaths.sessionIdPath)).toBe(true);
    expect(await fileExists(newPaths.eventsLogPath)).toBe(true);

    const moved = await readState(newPaths.stateFilePath);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.feature_desc).toBe('Legacy Feature');
      expect(moved.value.brainstorm).toBe('done');
    }

    const session = await readFile(newPaths.sessionIdPath, 'utf-8');
    expect(session).toBe('old-session-id');
  });

  it('hoists bootstrap_mode into .pipeline/project-state.json', async () => {
    const legacyState = join(dir, '.pipeline', 'conduct-state.json');
    await writeState(legacyState, {
      feature_desc: 'Boot Feature',
      bootstrap_mode: 'fresh',
      brainstorm: 'done',
    });

    await migrateLegacyPipelineLayout(dir);

    const project = await readProjectState(projectStatePath(dir));
    expect(project.bootstrap_mode).toBe('fresh');

    // Per-feature file no longer carries bootstrap_mode.
    const newPaths = resolveFeaturePaths(dir, 'Boot Feature');
    const moved = await readState(newPaths.stateFilePath);
    expect(moved.ok).toBe(true);
    if (moved.ok) {
      expect(moved.value.bootstrap_mode).toBeUndefined();
    }
  });

  it('is idempotent: a second invocation is a no-op', async () => {
    const result1 = await migrateLegacyPipelineLayout(dir);
    expect(result1.ran).toBe(false);
    expect(result1.reason).toBe('no_legacy_state');

    const legacyState = join(dir, '.pipeline', 'conduct-state.json');
    await writeState(legacyState, {
      feature_desc: 'Once Feature',
      brainstorm: 'done',
    });

    const result2 = await migrateLegacyPipelineLayout(dir);
    expect(result2.ran).toBe(true);

    const result3 = await migrateLegacyPipelineLayout(dir);
    expect(result3.ran).toBe(false);
    expect(result3.reason).toBe('no_legacy_state');
  });

  it('refuses to clobber an already-initialized feature directory', async () => {
    const legacyState = join(dir, '.pipeline', 'conduct-state.json');
    await writeState(legacyState, {
      feature_desc: 'Collision',
      brainstorm: 'done',
    });

    // Feature directory already exists with content.
    const target = resolveFeaturePaths(dir, 'Collision');
    await mkdir(target.pipelineDir, { recursive: true });
    await writeState(target.stateFilePath, { feature_desc: 'Collision', last_step: 'plan' });

    const result = await migrateLegacyPipelineLayout(dir);
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('feature_desc_collision');

    // Pre-existing feature state unchanged.
    const after = await readState(target.stateFilePath);
    expect(after.ok).toBe(true);
    if (after.ok) {
      expect(after.value.last_step).toBe('plan');
    }
  });

  it('does nothing when legacy state has no feature_desc to key by', async () => {
    const legacyState = join(dir, '.pipeline', 'conduct-state.json');
    await writeState(legacyState, { brainstorm: 'done' });

    const result = await migrateLegacyPipelineLayout(dir);
    expect(result.ran).toBe(false);
    expect(result.reason).toBe('feature_desc_missing');
    expect(await fileExists(legacyState)).toBe(true);
  });
});
