import { beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const FINISH_SKILL_PATH = join(process.cwd(), '..', '..', 'skills', 'finish', 'SKILL.md');

describe('finish documentation finalization contract', () => {
  let finishSkill: string;

  beforeAll(async () => {
    finishSkill = await readFile(FINISH_SKILL_PATH, 'utf-8');
  });

  it('orders the complete finalization and durable shipment sequence after PR creation', () => {
    const sequenceStart = finishSkill.indexOf('**A PR finish is one ordered shipment sequence.**');
    const sequenceEnd = finishSkill.indexOf('For Keep (no remote', sequenceStart);
    const sequence = finishSkill.slice(sequenceStart, sequenceEnd);
    const focusedPush = sequence.indexOf('git push  # focused changelog finalization push');
    const conditionalEndMatch = /^\s*fi\s*$/m.exec(sequence.slice(focusedPush));
    const positions = {
      prCreated: sequence.indexOf(
        'After you have created or reused the PR **inline**',
      ),
      finalize: sequence.indexOf('conduct-ts finalize-changelog-pr --pr-url <PR_URL>'),
      changeGuard: sequence.indexOf('if ! git diff --quiet -- CHANGELOG.md; then'),
      add: sequence.indexOf('git add CHANGELOG.md'),
      commit: sequence.indexOf('git commit -m "docs(changelog): link implementation PR"'),
      focusedPush,
      conditionalEnd:
        conditionalEndMatch === null ? -1 : focusedPush + conditionalEndMatch.index,
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

  it('commits and pushes only when finalization changes CHANGELOG.md', () => {
    expect(finishSkill).toMatch(
      /if ! git diff --quiet -- CHANGELOG\.md; then[\s\S]*git add CHANGELOG\.md[\s\S]*git commit -m "docs\(changelog\): link implementation PR"[\s\S]*git push  # focused changelog finalization push[^\n]*\r?\ngit merge-base --is-ancestor HEAD refs\/remotes\/origin\/<branch>\r?\nfi(?:\r?\n|$)/,
    );
  });

  it('stops before durable shipment records when finalization, commit, or push fails', () => {
    expect(finishSkill).toMatch(
      /If finalization, the focused commit, or its push fails, \*\*STOP immediately\.\*\*[\s\S]{0,800}Do NOT run `conduct-ts shipped-record`[\s\S]{0,800}Do NOT run `conduct-ts finish-record`[\s\S]{0,800}Do NOT write `\.pipeline\/finish-choice`/,
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

  it('preserves the existing finish path when no implementation token exists', () => {
    expect(finishSkill).toMatch(
      /When no implementation-PR token exists,[\s\S]{0,500}successful no-op[\s\S]{0,500}do not create a changelog commit or push[\s\S]{0,500}continue with the existing shipped-record sequence/,
    );
  });
});
