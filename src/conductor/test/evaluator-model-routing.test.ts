// Covers: task:3
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testFileDir = dirname(fileURLToPath(import.meta.url));

function readSkill(skillName: string): string {
  return readFileSync(join(testFileDir, '..', '..', '..', 'skills', skillName, 'SKILL.md'), 'utf8');
}

function evaluatorModelSelectionBlock(skill: string): string {
  const match = skill.match(
    /^\*\*Claude model selection by batch content:\*\*\n((?:- .*\n?)+)/m,
  );
  expect(match, 'expected the evaluator model-selection block').not.toBeNull();
  return match![1];
}

describe('code-review evaluator model routing (Task 3)', () => {
  it('offers only the default and risk-domain top-tier choices', () => {
    const selection = evaluatorModelSelectionBlock(readSkill('code-review'));
    const choices = selection.trim().split('\n');

    expect(choices).toEqual([
      expect.stringMatching(/Claude Code Sonnet.*model="sonnet".*default/i),
      expect.stringMatching(
        /Claude Code Fable.*model="fable".*concurrency.*state mutation.*security.*auth.*money/i,
      ),
    ]);
    expect(selection).toMatch(/availability ladder/i);

    const retiredCategories = [
      'value objects',
      'pure functions',
      'config',
      'infra',
      'view templates',
      'financial calculations',
      'complex domain interactions',
    ].filter((category) => selection.toLowerCase().includes(category));
    expect(retiredCategories).toEqual([]);
  });

  it('scopes every Claude model parameter to Claude Code on its physical line', () => {
    const unscopedModelLines = readSkill('code-review')
      .split('\n')
      .filter((line) => /model="[^"]+"/.test(line) && !line.includes('Claude Code'));

    expect(unscopedModelLines).toEqual([]);
  });
});
