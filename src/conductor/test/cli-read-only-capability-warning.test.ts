import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  probeInteractiveReadOnlyReviewCapabilities,
} from '../src/index.js';
import { ConductorEventEmitter } from '../src/ui/events.js';

describe('interactive read-only review capability config warnings', () => {
  it('warns and emits an unavailable enabled custom-rubric capability before the run', async () => {
    const events = new ConductorEventEmitter();
    const emitted: unknown[] = [];
    events.on('build_review_read_only_capability', (event) => { emitted.push(event); });
    const warn = vi.fn();
    const probe = vi.fn(async () => ({
      provider: 'codex', platform: 'linux', status: 'unavailable' as const, reason: 'sandbox helper is unavailable',
    }));

    const capabilities = await probeInteractiveReadOnlyReviewCapabilities({
      config: {
        build_review: {
          custom_rubrics: {
            security: {
              enabled: true,
              skill: 'security-review',
              question: 'Review the change',
              llm_provider: 'codex',
            },
          },
        },
      },
      projectRoot: '/workspace',
      events,
      platform: 'linux',
      probe,
      warn,
    });

    expect(warn).toHaveBeenCalledWith(
      '⚠ Config warning: Read-only build-review capability unavailable for codex on linux: sandbox helper is unavailable',
    );
    expect(emitted).toEqual([{
      type: 'build_review_read_only_capability',
      provider: 'codex',
      platform: 'linux',
      status: 'unavailable',
      reason: 'sandbox helper is unavailable',
    }]);
    expect(capabilities).toEqual({
      codex: {
        provider: 'codex', platform: 'linux', status: 'unavailable', reason: 'sandbox helper is unavailable',
      },
    });
  });

  it('does not probe when no custom rubric is enabled', async () => {
    const probe = vi.fn();

    await expect(probeInteractiveReadOnlyReviewCapabilities({
      config: {
        build_review: {
          custom_rubrics: {
            disabled: {
              enabled: false,
              skill: 'security-review',
              question: 'Review the change',
              llm_provider: 'codex',
            },
          },
        },
      },
      projectRoot: '/workspace',
      events: new ConductorEventEmitter(),
      platform: 'linux',
      probe,
      warn: vi.fn(),
    })).resolves.toEqual({});

    expect(probe).not.toHaveBeenCalled();
  });

  it('probes after config warnings but before a step runner or Conductor is created, then threads the result', async () => {
    const source = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
    const probeAt = source.indexOf('probeInteractiveReadOnlyReviewCapabilities({ config, projectRoot, events })');
    const runnerAt = source.indexOf('new DefaultStepRunner(');
    const conductorAt = source.indexOf('new Conductor({');

    expect(probeAt).toBeGreaterThan(source.indexOf('⚠ Config warning:'));
    expect(probeAt).toBeLessThan(runnerAt);
    expect(probeAt).toBeLessThan(conductorAt);
    expect(source.slice(conductorAt)).toMatch(
      /readOnlyReviewCapabilities !== undefined \? \{ readOnlyReviewCapabilities \} : \{\}/,
    );
  });
});
