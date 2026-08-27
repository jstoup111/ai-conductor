// Covers: S1.1, S1.2, S1.3, task:5
/**
 * Acceptance proof for the installed-visualizer submission flow.
 *
 * This stays at the smallest real internal path: production filesystem discovery
 * registers the plugin, production selection resolves the configured name, and
 * production lifecycle wiring attaches it to the real event emitter. A registry
 * fixture alone would not prove the discovery-to-selection seam that Story 1 adds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPlugins } from '../../src/engine/plugin-loader.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import * as conductorEntry from '../../src/index.js';
import type { HarnessConfig } from '../../src/types/config.js';
import type { VisualizerPlugin } from '../../src/types/plugin.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

interface AcceptanceStartContext {
  runId?: string;
  project?: string;
  feature?: string;
  branch?: string;
  engineVersion?: string;
  pipelineDir?: string;
}

interface AcceptanceFactoryContext {
  config: HarnessConfig & { visualizers?: string[] };
  pipelineDir: string;
  startContext: AcceptanceStartContext;
  emitter: ConductorEventEmitter;
}

type SelectVisualizers = (
  registry: PluginRegistry,
  config: HarnessConfig & { visualizers?: string[] },
  context: AcceptanceFactoryContext,
) => VisualizerPlugin[];

type StartVisualizers = (
  visualizers: VisualizerPlugin[],
  emitter: ConductorEventEmitter,
  context: AcceptanceStartContext,
) => VisualizerPlugin[];

const scratchDirs: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function installVisualizer(parent: string, name: string, marker = name): Promise<void> {
  const pluginDir = join(parent, name);
  await mkdir(pluginDir, { recursive: true });
  await writeFile(
    join(pluginDir, 'plugin.yml'),
    `kind: visualizer\nname: ${name}\nentrypoint: index.js\n`,
    'utf8',
  );
  await writeFile(
    join(pluginDir, 'index.js'),
    `export default {
  name: '${name}',
  received: [],
  start(emitter) {
    emitter.on('feature_complete', (event) => this.received.push('${marker}:' + event.featureDesc));
  },
  async stop() {}
};
`,
    'utf8',
  );
}

async function runInstalledConnectors(options: {
  globalNames?: string[];
  projectNames?: string[];
  enabledNames: string[];
}): Promise<VisualizerPlugin[]> {
  const root = await mkdtemp(join(tmpdir(), 'visualizer-connector-'));
  scratchDirs.push(root);
  const globalPlugins = join(root, 'global-plugins');
  const projectPlugins = join(root, 'project-plugins');
  const pipelineDir = join(root, '.pipeline');
  await mkdir(globalPlugins, { recursive: true });
  await mkdir(projectPlugins, { recursive: true });
  await Promise.all((options.globalNames ?? []).map((name) => installVisualizer(globalPlugins, name)));
  await Promise.all((options.projectNames ?? []).map((name) => installVisualizer(projectPlugins, name)));

  const registry = new PluginRegistry();
  await discoverPlugins(globalPlugins, projectPlugins, registry);

  const config = { visualizers: options.enabledNames } as HarnessConfig & { visualizers: string[] };
  const emitter = new ConductorEventEmitter();
  const startContext: AcceptanceStartContext = {
    runId: 'run-1516',
    project: root,
    feature: 'connector-seam-for-event-submissions-is-registered',
    branch: 'feat/connector-seam',
    engineVersion: '0.0.0-test',
    pipelineDir,
  };
  const factoryContext: AcceptanceFactoryContext = {
    config,
    pipelineDir,
    startContext,
    emitter,
  };
  const selectVisualizers = (conductorEntry as { selectVisualizers?: SelectVisualizers })
    .selectVisualizers;
  expect(selectVisualizers, 'production startup must expose the registry selection seam')
    .toBeTypeOf('function');

  const selected = selectVisualizers!(registry, config, factoryContext);
  const startVisualizers = conductorEntry.buildVisualizers as StartVisualizers;
  const started = startVisualizers(selected, emitter, startContext);
  await emitter.emit({
    type: 'feature_complete',
    featureDesc: 'connector-seam-for-event-submissions-is-registered',
  });
  return started;
}

describe('acceptance: installed visualizer receives run event submissions', () => {
  it('discovers a project plugin, selects its configured name, and delivers an emitted event', async () => {
    const started = await runInstalledConnectors({
      projectNames: ['submission-recorder'],
      enabledNames: ['submission-recorder'],
    });
    expect(started).toHaveLength(1);
    expect(started[0]?.name).toBe('submission-recorder');
    expect((started[0] as VisualizerPlugin & { received: string[] }).received).toEqual([
      'submission-recorder:connector-seam-for-event-submissions-is-registered',
    ]);
    await conductorEntry.stopVisualizers(started);
  });

  it('selects a connector installed only in the global plugin directory', async () => {
    const started = await runInstalledConnectors({
      globalNames: ['global-recorder'],
      enabledNames: ['global-recorder'],
    });
    expect(started).toHaveLength(1);
    expect((started[0] as VisualizerPlugin & { received: string[] }).received).toEqual([
      'global-recorder:connector-seam-for-event-submissions-is-registered',
    ]);
    await conductorEntry.stopVisualizers(started);
  });

  it('delivers the same emitted event to two enabled connectors', async () => {
    const started = await runInstalledConnectors({
      projectNames: ['first-recorder', 'second-recorder'],
      enabledNames: ['first-recorder', 'second-recorder'],
    });
    expect(started).toHaveLength(2);
    expect(
      started.map((plugin) => (plugin as VisualizerPlugin & { received: string[] }).received),
    ).toEqual([
      ['first-recorder:connector-seam-for-event-submissions-is-registered'],
      ['second-recorder:connector-seam-for-event-submissions-is-registered'],
    ]);
    await conductorEntry.stopVisualizers(started);
  });
});
