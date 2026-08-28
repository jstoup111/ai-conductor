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

  it('does not count validation as a key consumer', () => {
    for (const [key, declaration] of Object.entries(configConsumerRegistry)) {
      expect(declaration.consumer, `${key} must name its runtime consumer`).not.toBe(
        'src/conductor/src/engine/config.ts',
      );
    }
  });

  it('covers every nested validator block', () => {
    expect(Object.keys(CONFIG_CONSUMER_KEY_SETS)).toEqual(expect.arrayContaining([
      'steps.parallel',
      'steps.by_tier',
      'build_review',
      'build_review.rubrics',
      'ci_watch',
      'kickback_escalation',
      'cumulative_kickback_bound',
      'conflict_check',
      'prd_audit',
      'architecture_review_as_built',
      'architecture_review_as_built.remediation',
      'architecture_review_as_built.checks',
      'assess',
      'test_suite',
      'build_progress',
      'provider_stream',
      'build_progress_halt',
      'gate_code_validity',
      'retry_routing',
      'markdown_viewer',
      'mermaid_renderer',
    ]));
  });

  it.each(['test_suite', 'prd_audit', 'assess', 'build_progress'] as const)(
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
