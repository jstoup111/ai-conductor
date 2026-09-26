// Covers: task:13
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import { PluginRegistry } from '../../src/engine/plugin-registry.js';
import { bootDispatchingCliProviders } from '../../src/index.js';

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('runDaemonMode provider discovery at boot', () => {
  it('rejects a missing configured pi before daemon dispatch', async () => {
    const projectRoot = await mkdtemp(join(process.env.TMPDIR ?? '/tmp', 'daemon-provider-boot-'));
    roots.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor'), { recursive: true });
    await writeFile(join(projectRoot, '.ai-conductor', 'config.yml'), 'llm_provider: pi\n', 'utf8');

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
          if (executable === 'pi') throw Object.assign(new Error('missing pi'), { code: 'ENOENT' });
          return { exitCode: 0 };
        },
      });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
    }

    expect({ errorMessage, dispatchCalls: dispatch.mock.calls.length }).toEqual({
      errorMessage: expect.stringMatching(/llm_provider.*pi.*not installed.*not-found/i),
      dispatchCalls: 0,
    });
  });

  it('uses the same installed set for the CLI boot registry', async () => {
    const events = new ConductorEventEmitter();
    const discoveries: unknown[] = [];
    events.on('provider_discovery', async (event) => { discoveries.push(event); });
    const registry = new PluginRegistry();

    await bootDispatchingCliProviders({
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
});
