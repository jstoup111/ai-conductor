// Covers: task:3, task:4, task:5
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

function pipelineEvaluatorScalingTable(skill: string): {
  frequencyCells: string[];
  override: string | undefined;
} {
  const match = skill.match(
    /^\| Tier \| Intermediate batches \| Final batch \| Intermediate model \| Final model \|\n\|[-| ]+\|\n((?:\|.*\n){3})\n(?<override>\*\*Risk-domain override:\*\*.*)$/m,
  );
  expect(match, 'expected the evaluator scaling table and its risk-domain override').not.toBeNull();

  return {
    frequencyCells: match![1]
      .trim()
      .split('\n')
      .flatMap((row) => row.split('|').slice(2, 4).map((cell) => cell.trim()))
      .filter((cell, index, cells) => cells.indexOf(cell) === index),
    override: match!.groups?.override,
  };
}

function unscopedClaudeModelLines(skill: string): string[] {
  return skill
    .split('\n')
    .filter((line) => /model="(sonnet|opus|haiku|fable)"/.test(line) && !line.includes('Claude'));
}

function expectClaudeModelParametersToBeScoped(skill: string): void {
  expect(unscopedClaudeModelLines(skill)).toEqual([]);
}

function expectUnchangedEvaluatorRoutingSurface(codeReviewSkill: string, pipelineSkill: string): void {
  expect(codeReviewSkill).toContain(codeReviewFreshContextIsolation);
  expect(pipelineSkill).toContain(pipelineFreshContextIsolation);
  expect(pipelineSkill).toContain(pipelineScalingTableHeader);
}

const codeReviewFreshContextIsolation =
  'The evaluator runs in a **fresh context**\n— it does not share conversation history with the generator.';
const pipelineFreshContextIsolation =
  'model per tier and batch position) with **fresh, scoped context** (no shared state with the\ngenerator).';
const pipelineScalingTableHeader =
  '| Tier | Intermediate batches | Final batch | Intermediate model | Final model |';

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
    expectClaudeModelParametersToBeScoped(readSkill('code-review'));
  });
});

describe('pipeline evaluator model routing (Task 4)', () => {
  it('preserves evaluation frequency while elevating risk-domain batches', () => {
    const scaling = pipelineEvaluatorScalingTable(readSkill('pipeline'));

    expect(scaling).toMatchObject({
      frequencyCells: ['Skipped', 'Always', 'Every 8 tasks', 'Every 4 tasks'],
      override: expect.stringMatching(
        /concurrency.*state mutation.*security.*auth.*money.*Claude Code Fable.*top Claude tier/i,
      ),
    });
  });
});

describe('evaluator routing provider scoping and unchanged surface (Task 5)', () => {
  it('rejects an injected unscoped Claude model parameter while accepting committed dispatches', () => {
    const codeReviewSkill = readSkill('code-review');
    const injectedUnscopedDispatch = `${codeReviewSkill}\n- evaluator dispatch (\`model="fable"\`)`;

    expectClaudeModelParametersToBeScoped(codeReviewSkill);
    expect(() => expectClaudeModelParametersToBeScoped(injectedUnscopedDispatch)).toThrow();
  });

  it('rejects fresh-context isolation removed from either skill', () => {
    const codeReviewSkill = readSkill('code-review');
    const pipelineSkill = readSkill('pipeline');

    expectUnchangedEvaluatorRoutingSurface(codeReviewSkill, pipelineSkill);
    expect(() =>
      expectUnchangedEvaluatorRoutingSurface(
        codeReviewSkill.replace(codeReviewFreshContextIsolation, ''),
        pipelineSkill,
      ),
    ).toThrow();
    expect(() =>
      expectUnchangedEvaluatorRoutingSurface(
        codeReviewSkill,
        pipelineSkill.replace(pipelineFreshContextIsolation, ''),
      ),
    ).toThrow();
  });

  it('rejects removal of the pipeline intermediate or final model column', () => {
    const codeReviewSkill = readSkill('code-review');
    const pipelineSkill = readSkill('pipeline');

    expectUnchangedEvaluatorRoutingSurface(codeReviewSkill, pipelineSkill);
    for (const column of ['Intermediate model', 'Final model']) {
      expect(() =>
        expectUnchangedEvaluatorRoutingSurface(
          codeReviewSkill,
          pipelineSkill.replace(column, ''),
        ),
      ).toThrow();
    }
  });
});
