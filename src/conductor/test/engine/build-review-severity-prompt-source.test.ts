// Covers: task:2
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

const sentinel = vi.hoisted(() => 'SEVERITY_DEFINITIONS_FROM_ENGINE');

vi.mock('../../src/engine/build-review-contract.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../src/engine/build-review-contract.js')>(),
  renderBuildReviewSeverityDefinitions: () => sentinel,
}));

import {
  BUILD_REVIEW_SEVERITY_DEFINITIONS,
} from '../../src/engine/build-review-contract.js';
import {
  BUILD_REVIEW_RUBRIC_IDS,
  getBuildReviewRubricDescriptor,
} from '../../src/engine/build-review-registry.js';
import { captureRubricPrompt } from './build-review-severity-prompt-helper.js';

describe('build_review built-in severity prompt source', () => {
  it.each(BUILD_REVIEW_RUBRIC_IDS)('%s renders severity definitions from the engine rather than its SKILL.md', async (rubric) => {
    const skillPaths = BUILD_REVIEW_RUBRIC_IDS.map((id) => fileURLToPath(new URL(
      `../../../../skills/${getBuildReviewRubricDescriptor(id).skillName}/SKILL.md`, import.meta.url,
    )));
    const before = await Promise.all(skillPaths.map((path) => readFile(path)));
    const prompt = await captureRubricPrompt(rubric, `severity-source-${rubric}`);
    const after = await Promise.all(skillPaths.map((path) => readFile(path)));

    expect(prompt.split(sentinel)).toHaveLength(2);
    for (const meaning of Object.values(BUILD_REVIEW_SEVERITY_DEFINITIONS)) {
      expect(prompt).not.toContain(meaning);
    }
    expect(after).toEqual(before);
  });
});
