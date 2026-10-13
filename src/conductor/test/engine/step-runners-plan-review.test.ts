// Covers: task:16
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('plan_review step runner', () => {
  it('owns interactive review dispatch and persists its event-spine events through the runner emitter', async () => {
    const source = await readFile(new URL('../../src/engine/step-runners.ts', import.meta.url), 'utf8');
    expect(source).toContain("step === 'plan_review'");
    expect(source).toContain('runPlanReview({');
    expect(source).toContain('canonicalPath: this.projectRoot');
    expect(source).toContain('emit: async (event) => { await this.events?.emit(event); }');
  });
});
