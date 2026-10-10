// Covers: task:3, task:5, task:21, task:37, rem-ab5-1
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONFIG_CONSUMER_KEY_SETS } from '../../src/engine/config.js';
import {
  assertRegistryCovers,
  configConsumerRegistry,
} from './config-consumer-registry.js';

describe('config consumer registry', () => {
  it('is total over validator-accepted keys', () => {
    expect(() => assertRegistryCovers(CONFIG_CONSUMER_KEY_SETS, configConsumerRegistry)).not.toThrow();
  });

  it('declares the consumer for OTel attributes admitted by validation', () => {
    expect(CONFIG_CONSUMER_KEY_SETS.otel).toContain('attributes');
    expect(configConsumerRegistry).toMatchObject({
      'otel.attributes': {
        consumer: 'src/conductor/src/engine/otel/otel-config.ts',
      },
    });
  });

  it('does not count validation as a key consumer', () => {
    for (const [key, declaration] of Object.entries(configConsumerRegistry)) {
      if (key === 'harness_version') continue;
      expect(declaration.consumer, `${key} must name its runtime consumer`).not.toBe(
        'src/conductor/src/engine/config.ts',
      );
    }
  });

  it('declares loadProjectConfig’s satisfiesVersion gate as harness_version’s runtime consumer', () => {
    const configSource = readFileSync(new URL('../../src/engine/config.ts', import.meta.url), 'utf8');
    const loadProjectConfigStart = configSource.indexOf('async function loadProjectConfig');
    const loadProjectConfig = configSource.slice(
      loadProjectConfigStart,
      configSource.indexOf('export async function loadMergedConfig'),
    );

    expect(configConsumerRegistry.harness_version.consumer).toBe('src/conductor/src/engine/config.ts');
    expect(loadProjectConfig).toContain('satisfiesVersion(harnessVersion, validation.config.harness_version)');
  });

  it('covers every nested validator block', () => {
    expect(Object.keys(CONFIG_CONSUMER_KEY_SETS)).toEqual(expect.arrayContaining([
      'steps.parallel',
      'steps.by_tier',
      'build_review',
      'build_review.adjudication',
      'build_review.rubrics',
      'ci_watch',
      'kickback_escalation',
      'cumulative_kickback_bound',
      'prd_audit',
      'architecture_review_as_built',
      'architecture_review_as_built.remediation',
      'architecture_review_as_built.checks',
      'assess',
      'test_suite',
      'test_suite.commands[]',
      'test_suite.verification',
      'build_progress',
      'provider_stream',
      'build_progress_halt',
      'gate_code_validity',
      'retry_routing',
      'coverage_binding',
      'coverage_binding.judge',
      'markdown_viewer',
      'mermaid_renderer',
    ]));
  });

  it.each(['test_suite', 'prd_audit', 'assess', 'build_progress', 'coverage_binding'] as const)(
    'rejects a newly accepted %s key until it declares a consumer',
    (block) => {
      const extendedSets = {
        ...CONFIG_CONSUMER_KEY_SETS,
        [block]: [...CONFIG_CONSUMER_KEY_SETS[block], 'new_probe_key'],
      };
      expect(() => assertRegistryCovers(extendedSets, configConsumerRegistry)).toThrow(
        `Config key is undeclared: ${block}.new_probe_key`,
      );
    },
  );

  it('declares verifier consumers for test-suite verification settings', () => {
    expect(configConsumerRegistry).toMatchObject({
      'test_suite.verification.mode': {
        consumer: 'src/conductor/src/engine/full-suite-verifier.ts',
      },
      'test_suite.verification.drift_budget': {
        consumer: 'src/conductor/src/engine/full-suite-verifier.ts',
      },
    });
  });

  it('registers the BUILD child cursor as a direct stacked-PR enablement consumer', () => {
    const childCursorSource = readFileSync(new URL('../../src/engine/child-cursor.ts', import.meta.url), 'utf8');

    expect(childCursorSource).toContain('config.config.stacked_prs?.enabled === true');
    expect(configConsumerRegistry['stacked_prs.enabled'].consumer).toEqual([
      'src/conductor/src/engine/engineer/land-spec.ts',
      'src/conductor/src/engine/step-runners.ts',
      'src/conductor/src/engine/child-cursor.ts',
    ]);
  });

  it('derives nested command-entry validation and registry coverage from one key set', () => {
    expect(CONFIG_CONSUMER_KEY_SETS['test_suite.commands[]']).toEqual([
      'command', 'working_directory', 'timeout_seconds',
    ]);
    expect(configConsumerRegistry).toMatchObject({
      'test_suite.commands[].command': { consumer: 'src/conductor/src/engine/full-suite-executor.ts' },
      'test_suite.commands[].working_directory': { consumer: 'src/conductor/src/engine/full-suite-executor.ts' },
      'test_suite.commands[].timeout_seconds': { consumer: 'src/conductor/src/engine/full-suite-executor.ts' },
    });
  });

  it('requires an explained reason for every none declaration', () => {
    for (const [key, declaration] of Object.entries(configConsumerRegistry)) {
      if (declaration.consumer === 'none') {
        expect(declaration.reason?.trim(), `${key} must explain why it is inert`).toBeTruthy();
      }
    }
    expect(() => assertRegistryCovers({ top: ['inert'] }, {
      inert: { consumer: 'none' },
    })).toThrow('Config key inert is none without a reason');
  });

  it('fails for an undeclared accepted key', () => {
    expect(() => assertRegistryCovers({ top: ['present'] }, {})).toThrow('Config key is undeclared: present');
  });

  it('fails for an unresolvable consumer module', () => {
    expect(() => assertRegistryCovers({ top: ['present'] }, {
      present: { consumer: 'missing/module.ts' },
    })).toThrow('Config key present has unresolvable consumer: missing/module.ts');
  });

  it('fails for an orphaned declaration', () => {
    expect(() => assertRegistryCovers({ top: [] }, {
      gone: { consumer: 'none', reason: 'inert until migration removal' },
    })).toThrow('Config-key declaration is orphaned: gone');
  });
});
