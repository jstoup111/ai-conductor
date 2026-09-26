// Covers: task:13, task:14, task:21
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { EventPersister } from '../../src/engine/event-persister.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import {
  CLI_PROVIDER_DISPATCHING_COMMANDS,
  bootDispatchingCliProviders,
  dispatchNonDispatchingCliCommand,
} from '../../src/index.js';
import { allInstalledProviderDiscoveryRunner } from './boot-test-helpers.js';

const bootOrder = vi.hoisted(() => ({
  calls: [] as string[],
}));

vi.mock('../../src/engine/plugin-loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/plugin-loader.js')>();
  return {
    ...actual,
    registerBuiltins: (...args: Parameters<typeof actual.registerBuiltins>) => {
      bootOrder.calls.push('registerBuiltins');
      return actual.registerBuiltins(...args);
    },
  };
});

vi.mock('../../src/engine/cli-builtins.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/cli-builtins.js')>();
  return {
    ...actual,
    registerCliBuiltins: (...args: Parameters<typeof actual.registerCliBuiltins>) => {
      bootOrder.calls.push('registerCliBuiltins');
      return actual.registerCliBuiltins(...args);
    },
  };
});

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  bootOrder.calls.splice(0);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runDaemonMode provider discovery at boot', () => {
  it('rejects a missing per-step codex before daemon dispatch', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-provider-boot-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'llm_provider: claude\nsteps:\n  build:\n    llm_provider: codex\n',
      'utf8',
    );

    const daemon = await import('../../src/engine/daemon.js');
    const dispatch = vi.spyOn(daemon, 'runDaemon').mockRejectedValue(new Error('__dispatched__'));
    const { runDaemonMode } = await import('../../src/daemon-cli.js');
    let errorMessage: string | undefined;

    try {
      await runDaemonMode({
        projectRoot,
        concurrency: 1,
        baseBranch: 'main',
        ensureFresh: async () => {},
        probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
        workSource: { discover: async () => [] },
        watch: false,
        providerDiscoveryRunner: async (executable) => {
          if (executable === 'codex') throw Object.assign(new Error('missing codex'), { code: 'ENOENT' });
          return { exitCode: 0 };
        },
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect({ errorMessage, dispatchCalls: dispatch.mock.calls.length }).toEqual({
      errorMessage: expect.stringMatching(/steps\.build\.llm_provider.*codex.*not installed.*not-found/i),
      dispatchCalls: 0,
    });
  });

  it('rejects a missing first provider in a per-step fallback ladder before daemon dispatch', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-provider-boot-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(
      join(projectRoot, '.ai-conductor', 'config.yml'),
      'llm_provider: claude\nsteps:\n  build:\n    llm_provider:\n      - pi\n      - claude\n',
      'utf8',
    );

    const daemon = await import('../../src/engine/daemon.js');
    const dispatch = vi.spyOn(daemon, 'runDaemon').mockRejectedValue(new Error('__dispatched__'));
    const { runDaemonMode } = await import('../../src/daemon-cli.js');

    await expect(runDaemonMode({
      projectRoot,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      workSource: { discover: async () => [] },
      watch: false,
      providerDiscoveryRunner: async (executable) => {
        if (executable === 'pi') throw Object.assign(new Error('missing pi'), { code: 'ENOENT' });
        return { exitCode: 0 };
      },
    })).rejects.toThrow(/steps\.build\.llm_provider\[0\].*pi.*not installed.*not-found/i);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('discovers before daemon built-in registration and persists one discovery event', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-provider-boot-'));
    roots.push(projectRoot);
    const daemon = await import('../../src/engine/daemon.js');
    vi.spyOn(daemon, 'runDaemon').mockResolvedValue({
      processed: [],
      stoppedReason: 'backlog_drained',
    });
    const { runDaemonMode } = await import('../../src/daemon-cli.js');

    await runDaemonMode({
      projectRoot,
      concurrency: 1,
      baseBranch: 'main',
      ensureFresh: async () => {},
      probeGhVersion: async () => ({ kind: 'ok', version: { major: 2, minor: 73, patch: 0 } }),
      workSource: { discover: async () => [] },
      watch: false,
      providerDiscoveryRunner: allInstalledProviderDiscoveryRunner((executable) => {
        bootOrder.calls.push(`discover:${executable}`);
      }),
    });

    const records = (await readFile(join(projectRoot, '.daemon', 'events.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(bootOrder.calls).toEqual([
      'discover:claude',
      'discover:codex',
      'discover:pi',
      'registerBuiltins',
    ]);
    expect(records.filter((record) => record.type === 'provider_discovery')).toEqual([
      expect.objectContaining({
        installed: ['claude', 'codex', 'pi'],
        missing: [],
      }),
    ]);
  });

  it('uses the same installed set for the CLI boot registry', async () => {
    const events = new ConductorEventEmitter();
    const discoveries: unknown[] = [];
    events.on('provider_discovery', async (event) => { discoveries.push(event); });
    const registry = new PluginRegistry();

    await bootDispatchingCliProviders({
      command: 'inline',
      registry,
      events,
      config: { llm_provider: 'claude' },
      rendererOpts: { stateFilePath: '/tmp/state.json', steps: [], readStateFn: async () => ({ ok: true, value: {} }), projectRoot: '/tmp' },
      providerDiscoveryRunner: async (executable) => {
        if (executable === 'pi') throw Object.assign(new Error('missing pi'), { code: 'ENOENT' });
        return { exitCode: 0 };
      },
    });

    expect({ providers: registry.list('llm_provider'), discoveries }).toEqual({
      providers: ['claude', 'codex'],
      discoveries: [{
        type: 'provider_discovery',
        installed: ['claude', 'codex'],
        missing: [{ id: 'pi', reason: 'not-found' }],
      }],
    });
  });

  it('discovers before CLI built-in registration and persists one discovery event', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'cli-provider-boot-'));
    roots.push(projectRoot);
    const events = new ConductorEventEmitter();
    const eventLogPath = join(projectRoot, '.pipeline', 'events.jsonl');
    const persister = new EventPersister(eventLogPath, events);
    persister.start();
    const registry = new PluginRegistry();

    try {
      await bootDispatchingCliProviders({
        command: 'inline',
        registry,
        events,
        config: { llm_provider: 'claude' },
        rendererOpts: {
          stateFilePath: join(projectRoot, '.pipeline', 'conduct-state.json'),
          steps: [],
          readStateFn: async () => ({ ok: true, value: {} }),
          projectRoot,
        },
        providerDiscoveryRunner: allInstalledProviderDiscoveryRunner((executable) => {
          bootOrder.calls.push(`discover:${executable}`);
        }),
      });
    } finally {
      persister.stop();
    }

    const records = (await readFile(eventLogPath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(bootOrder.calls).toEqual([
      'discover:claude',
      'discover:codex',
      'discover:pi',
      'registerCliBuiltins',
      'registerBuiltins',
    ]);
    expect(records.filter((record) => record.type === 'provider_discovery')).toEqual([
      expect.objectContaining({
        installed: ['claude', 'codex', 'pi'],
        missing: [],
      }),
    ]);
  });

  it('keeps provider discovery off non-dispatching CLI command handlers', async () => {
    const discovery = vi.fn(async () => ({
      installed: [],
      missing: [
        { id: 'claude', reason: 'not-found' },
        { id: 'codex', reason: 'not-found' },
        { id: 'pi', reason: 'not-found' },
      ],
    }));
    const dispatchRateCard = vi.fn(async () => 0);
    const dispatchOverlapScan = vi.fn(async () => 0);
    const dispatchRender = vi.fn(async () => 0);
    const commandResults = await Promise.all([
      dispatchNonDispatchingCliCommand(
        ['node', 'conduct', 'rate-card', 'refresh'],
        '/tmp',
        { discoverProviders: discovery, dispatchRateCard, dispatchOverlapScan, dispatchRender },
      ),
      dispatchNonDispatchingCliCommand(
        ['node', 'conduct', 'overlap-scan', '--files', 'a.ts'],
        '/tmp',
        { discoverProviders: discovery, dispatchRateCard, dispatchOverlapScan, dispatchRender },
      ),
      dispatchNonDispatchingCliCommand(
        ['node', 'conduct', 'render-diagrams', 'artifact.md'],
        '/tmp',
        { discoverProviders: discovery, dispatchRateCard, dispatchOverlapScan, dispatchRender },
      ),
    ]);

    expect({
      commands: [...CLI_PROVIDER_DISPATCHING_COMMANDS],
      commandResults,
      discoveryCalls: discovery.mock.calls.length,
    }).toEqual({
      commands: expect.arrayContaining(['inline', 'daemon']),
      commandResults: [0, 0, 0],
      discoveryCalls: 0,
    });
    expect(dispatchRateCard).toHaveBeenCalledWith({ kind: 'refresh', models: [] }, '/tmp');
    expect(dispatchOverlapScan).toHaveBeenCalledWith(
      { kind: 'overlap-scan', files: ['a.ts'] },
      { cwd: '/tmp' },
    );
    expect(dispatchRender).toHaveBeenCalledWith({ kind: 'render', files: ['artifact.md'] }, '/tmp');
    expect(CLI_PROVIDER_DISPATCHING_COMMANDS).not.toContain('rate-card');
    expect(CLI_PROVIDER_DISPATCHING_COMMANDS).not.toContain('overlap-scan');
    expect(CLI_PROVIDER_DISPATCHING_COMMANDS).not.toContain('render-diagrams');
  });
});
