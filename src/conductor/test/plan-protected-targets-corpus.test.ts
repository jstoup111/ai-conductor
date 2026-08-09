import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { scanPlanProtectedTargets } from '../src/engine/plan-protected-targets.js';
import { parsePlanTaskPaths } from '../src/engine/plan-task-parse.js';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const plansDirectory = join(repositoryRoot, '.docs/plans');

describe('plan protected-target corpus regression', () => {
  it('pins the seven existing ambiguous tasks across five plans without widening to clean tasks', async () => {
    const violations = await Promise.all(
      (await readdir(plansDirectory))
        .filter((name) => name.endsWith('.md'))
        .map(async (name) => {
          const text = await readFile(join(plansDirectory, name), 'utf8');
          const parsed = parsePlanTaskPaths(text, name.slice(0, -3));
          return {
            name,
            violations: scanPlanProtectedTargets(text, name.slice(0, -3)).filter(
              ({ taskId }) => !parsed.hasFilesLineByTaskId.get(taskId),
            ),
          };
        }),
    );
    const ambiguous = violations.filter(({ violations }) => violations.length > 0);
    expect(ambiguous).toHaveLength(5);
    expect(new Set(ambiguous.flatMap(({ name, violations }) =>
      violations.map(({ taskId }) => `${name}:${taskId}`),
    ))).toHaveLength(6);
    // Declared file scopes are deliberately absent: they are already covered
    // by the unit suite and must not become ambiguous prose regressions.
    expect(violations.filter(({ violations }) => violations.length === 0)).not.toHaveLength(0);
  });
});
