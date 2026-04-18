import { describe, it, expect } from 'vitest';
import type { ConductorEvent, RecoveryOption } from '../../src/types/events.js';
import type { HarnessConfig } from '../../src/types/config.js';

describe('Event types', () => {
  it('ConductorEvent step_started has correct shape', () => {
    const event: ConductorEvent = { type: 'step_started', step: 'brainstorm', index: 2 };
    expect(event.type).toBe('step_started');
  });

  it('ConductorEvent recovery_needed includes options', () => {
    const event: ConductorEvent = {
      type: 'recovery_needed',
      step: 'build',
      options: ['retry', 'interactive', 'back', 'skip', 'quit'],
    };
    expect(event.type).toBe('recovery_needed');
  });

  it('ConductorEvent covers all 13 event types', () => {
    const eventTypes: ConductorEvent['type'][] = [
      'step_started', 'step_completed', 'step_failed', 'checkpoint_reached',
      'recovery_needed', 'gate_blocked', 'tier_skip', 'config_skip', 'navigation_back',
      'rate_limit', 'session_reset', 'feature_complete', 'dashboard_refresh',
    ];
    expect(eventTypes).toHaveLength(13);
  });

  it('RecoveryOption has 5 values', () => {
    const options: RecoveryOption[] = ['retry', 'interactive', 'back', 'skip', 'quit'];
    expect(options).toHaveLength(5);
  });
});

describe('Config types', () => {
  it('HarnessConfig accepts full config', () => {
    const config: HarnessConfig = {
      harness_version: '>=1.0.0',
      steps: {
        disable: ['architecture-review', 'retro'],
        add: [{
          name: 'deploy-staging',
          after: 'build',
          skill: '.harness/skills/deploy-staging/SKILL.md',
          enforcement: 'gating',
        }],
      },
      skills: {
        overrides: { tdd: '.harness/skills/tdd/SKILL.md' },
        hooks: { brainstorm: { after: '.harness/hooks/notify.sh' } },
      },
      complexity: { default_tier: 'S' },
    };
    expect(config.harness_version).toBe('>=1.0.0');
  });

  it('HarnessConfig accepts empty config', () => {
    const config: HarnessConfig = {};
    expect(config.steps).toBeUndefined();
  });
});
