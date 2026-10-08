// Covers: task:7
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../../src/engine/config.js';
import { customStepsInPerChildRegion } from '../../src/engine/plan-slices.js';
import { buildStepRegistry } from '../../src/engine/steps.js';

const temporaryRoots: string[] = [];
const skill = '.ai-conductor/skills/custom/SKILL.md';

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface CustomStepFixture {
  after: string;
  gate?: boolean;
  kickback_target?: boolean;
}

function registry(steps: Record<string, CustomStepFixture>) {
  const configuredSteps: Record<string, {
    after: string;
    skill: string;
    enforcement: 'advisory';
    gate?: boolean;
    kickback_target?: boolean;
  }> = {};
  for (const [name, config] of Object.entries(steps)) {
    configuredSteps[name] = { enforcement: 'advisory', skill, ...config };
  }
  return buildStepRegistry({ steps: configuredSteps });
}

describe('customStepsInPerChildRegion', () => {
  it('leaves DECIDE, pre-acceptance, and post-review customs outside the per-child region', () => {
    expect(customStepsInPerChildRegion(registry({
      decide: { after: 'explore' },
      plain: { after: 'coverage_binding' },
      after_review: { after: 'build_review' },
    }))).toEqual([]);
  });

  it('returns registry-ordered customs whose resolved indexes are inside the region', () => {
    expect(customStepsInPerChildRegion(registry({
      lint_gate: { after: 'test_suite' },
      a: { after: 'build' },
      b: { after: 'a' },
      spec_lint: { after: 'acceptance_specs' },
    }))).toEqual([
      { name: 'spec_lint', coupling: 'in-region' },
      { name: 'a', coupling: 'in-region' },
      { name: 'b', coupling: 'in-region' },
      { name: 'lint_gate', coupling: 'in-region' },
    ]);
  });

  it('detects BUILD customs coupled to the loop without treating DECIDE or post-review customs as coupled', () => {
    expect(customStepsInPerChildRegion(registry({
      prep: { after: 'coverage_binding', kickback_target: true },
      prep2: { after: 'coverage_binding', gate: true },
      plain: { after: 'coverage_binding' },
      decide_gate: { after: 'explore', gate: true },
      decide_kickback: { after: 'explore', kickback_target: true },
      review_gate: { after: 'build_review', gate: true },
    }))).toEqual([
      { name: 'prep', coupling: 'loop-coupled' },
      { name: 'prep2', coupling: 'loop-coupled' },
    ]);
  });

  it('does not report an unresolved after target, which config validation still rejects', async () => {
    expect(customStepsInPerChildRegion(registry({ broken: { after: 'missing_step' } }))).toEqual([]);

    const projectRoot = await mkdtemp(join(tmpdir(), 'plan-slices-region-'));
    temporaryRoots.push(projectRoot);
    await mkdir(join(projectRoot, '.ai-conductor/skills/custom'), { recursive: true });
    await writeFile(join(projectRoot, skill), '---\nname: custom\n---\n');
    await writeFile(join(projectRoot, '.ai-conductor/config.yml'), [
      'steps:',
      '  broken:',
      '    after: missing_step',
      `    skill: ${skill}`,
      '    enforcement: advisory',
      '',
    ].join('\n'));

    const loaded = await loadConfig(projectRoot);
    expect(loaded).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('missing_step') },
    });
  });
});
