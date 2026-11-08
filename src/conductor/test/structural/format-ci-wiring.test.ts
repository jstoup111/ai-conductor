// Covers: task:7
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPOSITORY_ROOT = join(__dirname, '..', '..', '..', '..');
const workflow = readFileSync(join(REPOSITORY_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

export function formatWiringGaps(source: string): string[] {
  const gaps: string[] = [];
  const format = /^  format:\n([\s\S]*?)(?=^  \w)/m.exec(source)?.[0] ?? '';
  if (!format) gaps.push('job');
  if (!/needs: \[?changes/.test(format) || !/fetch-depth: 0/.test(format) || !/npm run format:check -- --base \$\{\{ github\.event\.pull_request\.base\.sha \}\}/.test(format)) gaps.push('job-wiring');
  if (!/ci-gate:\n\s+needs: \[[^\]]*\bformat\b/.test(source)) gaps.push('ci-gate-needs');
  if (!/FORMAT: \$\{\{ needs\.format\.result \}\}/.test(source) || !/format=\$FORMAT/.test(source) || !/"\$FORMAT"/.test(source)) gaps.push('ci-gate-result');
  return gaps;
}

describe('structural: format CI wiring', () => {
  it('runs format checks and gates their result', () => {
    expect(formatWiringGaps(workflow)).toEqual([]);
  });

  it('identifies independently missing ci-gate wiring', () => {
    expect(formatWiringGaps(workflow.replace(', format,', ','))).toContain('ci-gate-needs');
    expect(formatWiringGaps(workflow.replace('"$FORMAT" ', ''))).toContain('ci-gate-result');
  });
});
