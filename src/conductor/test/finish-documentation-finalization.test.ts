import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FINISH_SKILL_PATH = join(process.cwd(), '..', '..', 'skills', 'finish', 'SKILL.md');

describe('finish documentation shipment contract', () => {
  let finishSkill: string;

  beforeAll(async () => {
    finishSkill = await readFile(FINISH_SKILL_PATH, 'utf-8');
  });

  it('orders durable shipment after PR creation without changelog finalization', () => {
    const sequenceStart = finishSkill.indexOf('**A PR finish is one ordered shipment sequence.**');
    const sequenceEnd = finishSkill.indexOf('For Keep (no remote', sequenceStart);
    const sequence = finishSkill.slice(sequenceStart, sequenceEnd);
    const positions = {
      prCreated: sequence.indexOf(
        'After you have created or reused the PR **inline**',
      ),
      shipped: sequence.indexOf('conduct-ts shipped-record --slug <slug> --pr <PR_URL>'),
      durablePush: sequence.indexOf('git push  # durable shipped-record push'),
      durableVerification: sequence.indexOf(
        'git merge-base --is-ancestor HEAD refs/remotes/origin/<branch>',
        sequence.indexOf('git push  # durable shipped-record push'),
      ),
      recorded: sequence.indexOf(
        'conduct-ts finish-record --choice pr --pr-url <PR_URL>',
      ),
    };

    expect(positions).toSatisfy(
      (positions: Record<string, number>) =>
        Object.values(positions).every((position) => position >= 0) &&
        Object.values(positions).every(
          (position, index, ordered) => index === 0 || ordered[index - 1] < position,
        ),
    );
    expect(sequence).not.toMatch(/finalize-changelog-pr|IMPLEMENTATION_PR|CHANGELOG\.md/);

    const commandBlockMatch = /```\r?\n([\s\S]*?)\r?\n```/.exec(sequence);
    expect(commandBlockMatch).not.toBeNull();
    const commands = commandBlockMatch![1]
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(commands.at(-1)).toBe(
      'conduct-ts finish-record --choice pr --pr-url <PR_URL> --pipeline-dir /abs/path/to/.pipeline',
    );
  });

  it('authors the PR inline and forbids delegating it to another skill', () => {
    // Regression: finish delegated PR creation to `/pr`, which ended the turn.
    // The step never came back to run `conduct-ts finish-record`, so the
    // completion gate saw a missing `.pipeline/finish-choice` and failed try 1.
    const optionTwo = finishSkill.slice(
      finishSkill.indexOf('**Option 2: Push & PR**'),
      finishSkill.indexOf('#### STOP Gate: Verify Push + PR Before Recording Choice'),
    );

    expect({
      hasOptionTwo: optionTwo.length > 0,
      forbidsDelegation: /Do NOT\s+invoke the `\/pr` skill \(or any other skill\/subagent\)/.test(
        optionTwo,
      ),
      namesTheLostTurn: /ends this turn[\s\S]{0,200}finish-choice` unwritten/.test(
        optionTwo,
      ),
      hasInlineProcedure: optionTwo.includes(
        '#### 5a. Inline PR Authoring — Do This Yourself',
      ),
      inlinesThePush: optionTwo.includes('git push -u origin HEAD'),
      inlinesPrCreate: optionTwo.includes('gh pr create --title'),
      inlinesPrEdit: optionTwo.includes('gh pr edit --title'),
      // The refusal contract must survive: an environmental blocker still
      // leaves the marker unwritten rather than papering over it.
      keepsRefusalContract:
        /genuine blocker[\s\S]{0,200}do NOT write `\.pipeline\/finish-choice`/.test(
          optionTwo,
        ),
    }).toEqual({
      hasOptionTwo: true,
      forbidsDelegation: true,
      namesTheLostTurn: true,
      hasInlineProcedure: true,
      inlinesThePush: true,
      inlinesPrCreate: true,
      inlinesPrEdit: true,
      keepsRefusalContract: true,
    });
  });

  it('keeps shipped-record failure as the finish blocker', () => {
    expect(finishSkill).toMatch(
      /If either\s+fails, STOP: do not run `finish-record`, do not write local completion markers, and do not report\s+the feature shipped/,
    );
  });
});
