import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/daemon-cli.ts'), 'utf8');

describe('daemon-cli parked reconciliation wiring (Task 11)', () => {
  it('snapshots cleanup config once and binds a per-run cache into the daemon sweep', () => {
    expect(source).toMatch(/const reconcileParkedAutoCleanup = config\?\.reconcile_parked_auto_cleanup \?\? true;/);
    expect(source).toMatch(/const parkedSweepCache = new Map<string, ParkClassification>\(\);/);
    expect(source).toMatch(/reconcileParkedFeatures: async \(\) => \{[\s\S]*cache: parkedSweepCache,[\s\S]*autoCleanup: reconcileParkedAutoCleanup,/);
  });

  it('keeps dashboard classification annotate-only rather than enabling cleanup there', () => {
    const dashboardCall = source.match(/const reconciliation = await reconcileParkedFeatures\(\{([\s\S]*?)\}\);/);
    expect(dashboardCall?.[1]).toBeDefined();
    expect(dashboardCall?.[1]).not.toContain('autoCleanup');
    expect(source).toContain("classification === 'merged'\n                ? 'merged-ready'");
  });
});
