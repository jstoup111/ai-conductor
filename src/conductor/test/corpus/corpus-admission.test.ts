// Covers: task:1
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  corpusAdmissionFailures,
  largestMarkdownBytes,
  largestPlanIntentBytes,
  largestPlanTasksBytes,
} from './corpus-admission.js';

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'corpus-admission-'));
  roots.push(root);
  await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('live-corpus admission', () => {
  it('reports an oversized coherence input with its repository-relative path, size, and limit', async () => {
    const root = await fixture();
    const coherence = join(root, '.docs', 'coherence');
    const oversized = join(coherence, 'largest.md');
    await writeFile(oversized, 'coherence', 'utf8');

    const measure = await largestMarkdownBytes(coherence);
    const failures = corpusAdmissionFailures([{ dimension: 'coherence', measure, limit: measure.bytes - 1 }]);

    expect(failures).toEqual([
      `coherence: largest live input ${relative(root, oversized)} is ${measure.bytes} B, over the shipped limit ${measure.bytes - 1} B`,
    ]);
  });

  it('reports an oversized serialized plan task section with its path, size, and limit', async () => {
    const root = await fixture();
    const plans = join(root, '.docs', 'plans');
    const plan = join(plans, 'largest.md');
    await writeFile(plan, [
      '# Plan',
      '',
      '### Task 1: Preserve the corpus check',
      '',
      '**Done when:**',
      '- The serialized task section is measured.',
      '',
    ].join('\n'), 'utf8');

    const measure = await largestPlanTasksBytes(plans);
    const failures = corpusAdmissionFailures([{ dimension: 'tasks', measure, limit: measure.bytes - 1 }]);

    expect(failures).toEqual([
      `tasks: largest live input ${relative(root, plan)} is ${measure.bytes} B, over the shipped limit ${measure.bytes - 1} B`,
    ]);
  });

  it('admits inputs whose largest measurements equal their limits', async () => {
    const root = await fixture();
    const coherence = join(root, '.docs', 'coherence');
    const plans = join(root, '.docs', 'plans');
    await writeFile(join(coherence, 'input.md'), 'coherence', 'utf8');
    await writeFile(join(plans, 'input.md'), [
      '# Plan',
      '',
      '## Technical Approach',
      '',
      'Use a measured corpus input.',
      '',
      '### Task 1: Measure the corpus',
      '',
      '**Done when:**',
      '- The input is admitted at its limit.',
      '',
    ].join('\n'), 'utf8');

    const measures = await Promise.all([
      largestMarkdownBytes(coherence),
      largestPlanIntentBytes(plans),
      largestPlanTasksBytes(plans),
    ]);

    expect(corpusAdmissionFailures([
      { dimension: 'coherence', measure: measures[0], limit: measures[0].bytes },
      { dimension: 'intent', measure: measures[1], limit: measures[1].bytes },
      { dimension: 'tasks', measure: measures[2], limit: measures[2].bytes },
    ])).toEqual([]);
  });
});
