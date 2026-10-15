// Covers: task:4
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import chalk from 'chalk';

vi.mock('execa', () => ({ execa: vi.fn() }));

import { renderDaemonEvent } from '../src/daemon-cli.js';
import type { ConductorEvent } from '../src/types/index.js';

function lines(event: ConductorEvent): string[] {
  const output: string[] = [];
  renderDaemonEvent(event, (line) => output.push(line));
  return output;
}

const originalLevel = chalk.level;
afterEach(() => {
  chalk.level = originalLevel;
});

describe('renderDaemonEvent: provider_attempt_started', () => {
  beforeEach(() => {
    chalk.level = 0;
  });

  it('renders lifecycle and configured-member subjects with their providers', () => {
    expect(lines({
      type: 'provider_attempt_started', step: 'prd', provider: { kind: 'known', id: 'claude' },
    })[0]).toContain('prd on claude');
    expect(lines({
      type: 'provider_attempt_started', step: 'review', provider: { kind: 'known', id: 'codex' },
      executionContext: {
        executionId: 'review-security',
        subject: { kind: 'configured-member', parentGroup: 'review', member: 'security' },
      },
    })[0]).toContain('review / security on codex');
  });

  it('renders a nonblank model and omits absent model punctuation', () => {
    expect(lines({
      type: 'provider_attempt_started', step: 'prd', provider: { kind: 'known', id: 'claude' }, model: 'opus',
    })[0]).toContain('claude (opus)');
    const [withoutModel] = lines({
      type: 'provider_attempt_started', step: 'prd', provider: { kind: 'known', id: 'claude' },
    });
    expect(withoutModel).not.toMatch(/undefined|null|\(\)/);
  });

  it('renders an unknown provider without retaining a prior known provider', () => {
    const known = lines({
      type: 'provider_attempt_started', step: 'prd', provider: { kind: 'known', id: 'claude' },
    });
    const unknown = lines({
      type: 'provider_attempt_started', step: 'prd', provider: { kind: 'unknown' },
    });

    expect(known).toHaveLength(1);
    expect(unknown[0]).toContain('prd provider unknown');
    expect(unknown[0]).not.toContain('claude');
  });
});
