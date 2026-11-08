import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const skill = fileURLToPath(new URL('../../../../skills/composer/SKILL.md', import.meta.url));
describe('composer checkpoint contract', () => {
  it('checkpoints accepted steps and makes resume record-driven', async () => {
    const body = await readFile(skill, 'utf8');
    expect(body).toMatch(/compose checkpoint --worktree <worktreePath> --step <step> --accept --notes-file <notes\.json>/);
    expect(body).toMatch(/first unaccepted step/i);
    expect(body).toMatch(/Do not rerun an accepted step/i);
    expect(body).toMatch(/draft as unaccepted/i);
  });
});
