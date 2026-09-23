import { describe, expect, it, vi } from 'vitest';

import { runReleaseMetadataCheckAction as runDirectReleaseMetadataCheck } from '../src/engine/release-metadata-check-action.js';
import { runReleaseMetadataCheckAction as runReleaseMetadataCheckFromEntry } from '../src/engine/self-host/release-actions.js';

function actionInput(body: string) {
  return {
    github: {},
    context: { payload: { pull_request: { body } } },
    core: { setOutput: vi.fn() },
  };
}

async function failureMessage(
  action: typeof runDirectReleaseMetadataCheck,
  body: string,
): Promise<string> {
  try {
    await action(actionInput(body));
    throw new Error('expected release metadata validation to fail');
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe('self-host release actions entry (Task 16)', () => {
  it.each([
    [
      'a valid note disposition',
      [
        'Release-Disposition: note',
        'Release-Category: Fixed',
        'Release-Semver: patch',
        'Release-Note: Preserve the release metadata action entry contract.',
      ].join('\n'),
    ],
    ['a no-note disposition', 'Release-Disposition: no-note'],
  ])('accepts %s exactly as the direct action does', async (_caseName, body) => {
    expect(runReleaseMetadataCheckFromEntry).toBe(runDirectReleaseMetadataCheck);

    await expect(runReleaseMetadataCheckFromEntry(actionInput(body))).resolves.toBeUndefined();
    await expect(runDirectReleaseMetadataCheck(actionInput(body))).resolves.toBeUndefined();
  });

  it.each([
    ['no release metadata', 'Implementation details without a release declaration.', 'Invalid release disposition: Disposition'],
    [
      'a category outside the allowed set',
      [
        'Release-Disposition: note',
        'Release-Category: Experimental',
        'Release-Semver: patch',
        'Release-Note: This category must fail closed.',
      ].join('\n'),
      'Invalid release disposition: Category',
    ],
  ])('fails closed for %s with the direct action error bytes', async (_caseName, body, expectedMessage) => {
    expect(await failureMessage(runReleaseMetadataCheckFromEntry, body)).toBe(expectedMessage);
    expect(await failureMessage(runDirectReleaseMetadataCheck, body)).toBe(expectedMessage);
  });
});
