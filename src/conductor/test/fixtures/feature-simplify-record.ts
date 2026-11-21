import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Satisfy BUILD's whole-feature simplify floor
 * (adr-2026-08-03-uncommitted-work-floor-under-build-completion D9) in fixtures
 * whose subject is something other than that floor. The floor itself is
 * covered by test/engine/feature-simplify.test.ts and
 * test/engine/conductor-build-escape-simplify.test.ts.
 */
export async function seedCleanFeatureSimplifyRecord(root: string, child?: number): Promise<void> {
  const owner = child === undefined ? 'feature' : `child-${child}`;
  await mkdir(join(root, '.pipeline', 'audit-trail'), { recursive: true });
  await writeFile(join(root, '.pipeline', 'audit-trail', `${owner}-simplification.md`), '## Verdict: CLEAN\n');
}
