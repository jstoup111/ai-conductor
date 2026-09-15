/**
 * Regression coverage for #587's former prompt-owned push recovery. PR
 * publication is now an engine-owned guarded operation, so the old reflog
 * fallback is intentionally absent from skills/pr/SKILL.md.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// test/ -> conductor/ -> src/ -> repo root
const REPO_ROOT = resolve(__dirname, '../../..');
const PR_SKILL_PATH = join(REPO_ROOT, 'skills/pr/SKILL.md');

describe('PR guarded-publication boundary (#587 regression)', () => {
  it('delegates publication to the engine instead of restoring a prompt-owned reflog/force-push fallback', async () => {
    const skillMd = await readFile(PR_SKILL_PATH, 'utf-8');

    expect(skillMd).toContain('Publication is engine-owned.');
    expect(skillMd).toContain('guarded remote write and PR operation');
    expect(skillMd).not.toMatch(/git reflog \| grep -E/);
    expect(skillMd).not.toMatch(/git push(?:\s|`)/);
  });
});
