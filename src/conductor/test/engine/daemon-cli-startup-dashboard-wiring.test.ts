// Covers: task:8
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderDashboard } from '../../src/engine/daemon-dashboard.js';

const source = readFileSync(resolve(process.cwd(), 'src/daemon-cli.ts'), 'utf8');

function startupDashboardBinding(): string {
  const start = source.indexOf('renderStartupDashboard: async () => {');
  const end = source.indexOf('\n      // FR-4:', start);
  if (start < 0 || end < 0) throw new Error('startup dashboard binding not found');
  return source.slice(start, end);
}

describe('daemon-cli startup dashboard wiring (Task 8)', () => {
  it('reuses the first discovery result without a dashboard fetch, refresh, or second discovery', () => {
    const binding = startupDashboardBinding();

    expect(source).toMatch(/let cachedStartupDiscovery: BacklogItem\[\] \| undefined;/);
    expect(source).toMatch(/const discoverBacklog = async \(options: \{ refresh: boolean \}\): Promise<BacklogItem\[\]> => \{[\s\S]*?cachedStartupDiscovery \?\?= result;[\s\S]*?return result;/);
    expect(binding).toContain('discover: () => Promise.resolve(cachedStartupDiscovery ?? []),');
    expect(binding).not.toContain('discoverTick(');
    expect(binding).not.toContain('fastForwardRoot(');
    expect(binding).not.toContain('fetch');
  });

  it('keeps parked classification informational and renders both reconciliation annotations', () => {
    const binding = startupDashboardBinding();

    expect(binding).toContain('autoCleanup: false,');
    expect(binding).toContain('reclaimMergedWorktrees: false,');

    const dashboard = renderDashboard({
      halted: [],
      inProgress: [],
      eligible: [{ slug: 'cached-eligible' }],
      processed: [],
      processedCount: 0,
      parked: [
        { slug: 'merged-feature', annotation: 'merged-ready' },
        { slug: 'orphan-feature', annotation: 'orphan' },
      ],
    });
    expect(dashboard).toContain('ELIGIBLE (1)');
    expect(dashboard).toContain('cached-eligible');
    expect(dashboard).toContain('merged — ready to reconcile');
    expect(dashboard).toContain('orphan — needs manual review');
  });
});
