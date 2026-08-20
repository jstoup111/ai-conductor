import { describe, expect, it } from 'vitest';
import { isCodeOrTestPath } from '../../src/engine/rebase.js';
import { isRuntimeSourcePath } from '../../src/engine/gate-invalidation.js';

describe('Task 9–11 rebase path classification', () => {
  it('treats harness markdown as source while retaining the complete documentation and test exclusion matrix', () => {
    const source = [
      'HARNESS.md', 'AGENT_INSTRUCTIONS.md', 'agents/planner.md',
      'skills/tdd/SKILL.md', 'tech-context/x.md', 'templates/y.md', 'docs-note.md',
    ];
    const excluded = [
      '.docs/plans/x.md', '.docs/audits/y.json', '.docs/coherence/.gitkeep',
      'docs/guides/z.md', 'docs/_config.yml', 'README', 'README.md',
      'a/b/README.md', 'CHANGELOG.md', 'x.test.ts', 'test/y.ts', 'test/guide.md',
    ];

    expect(source.every(isRuntimeSourcePath)).toBe(true);
    expect(excluded.every((path) => !isRuntimeSourcePath(path))).toBe(true);
    expect(excluded.filter((path) => /(?:\.test\.|(?:^|\/)test\/)/.test(path))
      .every((path) => isCodeOrTestPath(path))).toBe(true);
  });
});
