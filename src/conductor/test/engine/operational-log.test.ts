// Covers: task:5
import { describe, expect, it, vi } from 'vitest';

import {
  captureDaemonDiagnosticOwnership,
  daemonProjectDiagnosticOwnership,
  formatDaemonFeatureTag,
  withDaemonLogFeatureOwnership,
} from '../../src/engine/daemon-log.js';
import { createOperationalLogger } from '../../src/engine/operational-log.js';

describe('operational logger', () => {
  it('emits raw typed occurrences best-effort while preserving local sink calls and results', async () => {
    const occurrences: unknown[] = [];
    const localCalls: unknown[][] = [];
    const localSink = vi.fn((...args: unknown[]) => {
      localCalls.push(args);
      return `local:${String(args[0])}`;
    });
    const logger = createOperationalLogger({
      emit: async (occurrence) => {
        occurrences.push(occurrence);
        throw new Error('log listener unavailable');
      },
      localSink,
      now: () => 1_700_000_000_000,
      ownership: { scope: 'project' },
    });

    const results = [
      logger.info('starting daemon'),
      logger.warn('retrying feature'),
      logger.error('worker failed'),
    ];
    await Promise.resolve();

    expect({ results, localCalls, occurrences }).toEqual({
      results: ['local:info', 'local:warn', 'local:error'],
      localCalls: [
        ['info', 'starting daemon'],
        ['warn', 'retrying feature'],
        ['error', 'worker failed'],
      ],
      occurrences: [
        {
          type: 'operational_log',
          severity: 'info',
          body: 'starting daemon',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'project' },
        },
        {
          type: 'operational_log',
          severity: 'warn',
          body: 'retrying feature',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'project' },
        },
        {
          type: 'operational_log',
          severity: 'error',
          body: 'worker failed',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'project' },
        },
      ],
    });
  });

  it('keeps interleaved feature and project diagnostics owned by their immutable capture', async () => {
    const occurrences: unknown[] = [];
    const featureA = 'shared-daemon-log-prefix-feature-alpha';
    const featureB = 'shared-daemon-log-prefix-feature-beta';
    let releaseDelayedA!: () => void;
    let delayedA!: Promise<void>;

    const logger = (ownership: ReturnType<typeof captureDaemonDiagnosticOwnership>) =>
      createOperationalLogger({
        emit: (occurrence) => {
          occurrences.push(occurrence);
        },
        localSink: () => undefined,
        now: () => 1_700_000_000_000,
        ownership,
      });

    await withDaemonLogFeatureOwnership(featureA, async () => {
      const featureALogger = logger(captureDaemonDiagnosticOwnership());
      delayedA = new Promise<void>((resolve) => {
        releaseDelayedA = resolve;
      }).then(() => {
        featureALogger.warn('A delayed warning after its scope ended');
      });
      featureALogger.warn('A ordinary warning');
    });

    await withDaemonLogFeatureOwnership(featureB, async () => {
      const featureBLogger = logger(captureDaemonDiagnosticOwnership());
      featureBLogger.error('B ordinary error');
      releaseDelayedA();
      await delayedA;
      logger(daemonProjectDiagnosticOwnership()).error(
        '\x1b[31m[other-slug]\x1b[0m repository-wide diagnostic',
      );
      featureBLogger.warn('B warning while its scope continues');
    });

    expect({
      displayTags: [formatDaemonFeatureTag(featureA), formatDaemonFeatureTag(featureB)],
      occurrences,
    }).toEqual({
      displayTags: ['[shared-daemon-log-prefi…]', '[shared-daemon-log-prefi…]'],
      occurrences: [
        {
          type: 'operational_log',
          severity: 'warn',
          body: 'A ordinary warning',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'feature', featureSlug: featureA },
        },
        {
          type: 'operational_log',
          severity: 'error',
          body: 'B ordinary error',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'feature', featureSlug: featureB },
        },
        {
          type: 'operational_log',
          severity: 'warn',
          body: 'A delayed warning after its scope ended',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'feature', featureSlug: featureA },
        },
        {
          type: 'operational_log',
          severity: 'error',
          body: '\x1b[31m[other-slug]\x1b[0m repository-wide diagnostic',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'project' },
        },
        {
          type: 'operational_log',
          severity: 'warn',
          body: 'B warning while its scope continues',
          occurredAt: 1_700_000_000_000,
          ownership: { scope: 'feature', featureSlug: featureB },
        },
      ],
    });
  });
});
