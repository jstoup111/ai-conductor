import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BUILD_REVIEW_FINDING_VOCABULARIES } from '../../src/engine/build-review-domain.js';

const skill = fileURLToPath(new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url));
const retired = ['build-review-scope', 'build-review-root-cause', 'build-review-completeness'];

describe('build-review rubric skill catalog', () => {
  it('contains only the test-quality judgement skill', async () => {
    await expect(readFile(skill, 'utf8')).resolves.toContain('name: build-review-test-quality');
    expect(BUILD_REVIEW_FINDING_VOCABULARIES.testQuality.concernKinds).toEqual(['test-insensitive']);
    await Promise.all(retired.map(async (name) => {
      await expect(access(fileURLToPath(new URL(`../../../../skills/${name}/SKILL.md`, import.meta.url)), constants.F_OK)).rejects.toThrow();
    }));
  });
});
