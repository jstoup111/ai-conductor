import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectReadOnlyReviewCapabilityProviders } from '../../src/daemon-cli.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DAEMON_CLI_SRC = join(__dirname, '../../src/daemon-cli.ts');
const CONDUCTOR_SRC = join(__dirname, '../../src/engine/conductor.ts');

describe('Task 10 — daemon read-only review capability wiring', () => {
  it('probes each provider named by an enabled custom rubric exactly once', () => {
    expect(collectReadOnlyReviewCapabilityProviders({
      build_review: {
        custom_rubrics: {
          security: { enabled: true, skill: 'security-review', question: 'Review', llm_provider: ['codex', 'claude'] },
          duplicate: { enabled: true, skill: 'another-review', question: 'Review', llm_provider: 'codex' },
          disabled: { enabled: false, skill: 'disabled-review', question: 'Review', llm_provider: 'claude' },
        },
      },
    })).toEqual(['codex', 'claude']);
  });

  it('does not probe when no enabled custom rubric is configured', () => {
    expect(collectReadOnlyReviewCapabilityProviders({
      build_review: {
        custom_rubrics: {
          disabled: { enabled: false, skill: 'disabled-review', question: 'Review', llm_provider: 'codex' },
        },
      },
    })).toEqual([]);
  });

  it('uses the injected probe, emits its frozen result before daemon dispatch, and threads it into each Conductor', async () => {
    const [daemonSource, conductorSource] = await Promise.all([
      readFile(DAEMON_CLI_SRC, 'utf8'),
      readFile(CONDUCTOR_SRC, 'utf8'),
    ]);

    expect(daemonSource).toMatch(/probeReadOnlyReviewCapability\??:/);
    expect(daemonSource).toMatch(/await\s+readOnlyReviewCapabilityProbe\(/);
    expect(daemonSource).toMatch(/type:\s*'build_review_read_only_capability'/);
    expect(daemonSource).toMatch(/new Conductor\(\{[\s\S]*?readOnlyReviewCapabilities,/);
    expect(conductorSource).toMatch(/readOnlyReviewCapabilities\??:/);
    expect(conductorSource).toMatch(/readOnlyReviewCapabilities:\s*this\.readOnlyReviewCapabilities/);
  });
});
