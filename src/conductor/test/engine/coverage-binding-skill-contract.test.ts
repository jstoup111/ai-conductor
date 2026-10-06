// Covers: task:9
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { issueJudgeClaimIds, parseJudgeBatchPayload } from '../../src/engine/coverage-binding-envelope.js';

const skillPath = fileURLToPath(new URL('../../../../skills/coverage-binding/SKILL.md', import.meta.url));

type ExampleEntry = Record<string, unknown> & { id: string };

/** The published example, checked against claim ids issued for engine-side digests. */
async function publishedExample(): Promise<{ entries: ExampleEntry[]; issued: ReadonlyMap<string, string> }> {
  const skill = await readFile(skillPath, 'utf8');
  const contract = skill.slice(skill.indexOf('## Result contract'));
  const fence = /```json\n([\s\S]*?)\n```/.exec(contract);
  if (!fence) throw new Error('coverage-binding SKILL.md publishes no JSON example under "## Result contract"');
  const example = JSON.parse(fence[1]!) as { verdicts: Array<Record<string, unknown>> };
  const entries = example.verdicts as ExampleEntry[];
  return { entries, issued: issueJudgeClaimIds(entries.map((_, index) => `sha256:issued-${index}`), 'criterion') };
}

async function judgementPolicy(): Promise<string> {
  const skill = await readFile(skillPath, 'utf8');
  return skill.slice(0, skill.indexOf('## Result contract'));
}

const batch = (entries: readonly Record<string, unknown>[]) => JSON.stringify({ verdicts: entries });

describe('coverage-binding skill contract', () => {
  it('requires each claim to be judged independently on its own evidence', async () => {
    const policy = await judgementPolicy();

    expect(policy).toMatch(/Each claim is judged independently against its cited task's `Done when` checks\./);
    expect(policy).toMatch(/No claim's\s+verdict may be inferred from another claim\./);
  });

  it('defines conflict claims as incompatible named-task obligations', async () => {
    const policy = (await judgementPolicy()).replace(/\s+/g, ' ');

    expect(policy).toMatch(/## Conflict claims/);
    expect(policy).toMatch(/`conflicts` only when satisfying a named task's `Done when` checks would necessarily violate the claim/);
    expect(policy).toMatch(/uncovered or differently covered criterion is `consistent`/);
    expect(policy).toMatch(/`conflicts` must list the conflicting task ids and state the incompatible requirement/);
  });

  it('publishes the conflict-claim result contract', async () => {
    const skill = await readFile(skillPath, 'utf8');

    expect(skill).toContain('{ verdicts: [{ id, verdict, taskIds?, conflict? }] }');
  });

  it('publishes an example payload the engine batch parser accepts', async () => {
    const { entries, issued } = await publishedExample();

    const parsed = parseJudgeBatchPayload(batch(entries), issued);

    expect(parsed).toEqual({
      ok: true,
      verdicts: new Map(entries.map(({ id, ...verdict }) => [issued.get(id), verdict])),
    });
    expect(entries.map((entry) => entry.verdict).sort()).toEqual(['asserts', 'does-not-assert']);
  });

  it.each([
    {
      rule: 'a verdict outside the closed vocabulary',
      mutate: (entries: ExampleEntry[]) => entries.map((entry, index) => index === 0 ? { ...entry, verdict: 'partially-asserts' } : entry),
      reason: 'payload verdict must be asserts or does-not-assert',
    },
    {
      rule: 'missingAssertion on an asserts verdict',
      mutate: (entries: ExampleEntry[]) => entries.map((entry) => entry.verdict === 'asserts' ? { ...entry, missingAssertion: 'none' } : entry),
      reason: 'asserts payload must contain only verdict',
    },
    {
      rule: 'does-not-assert without a missingAssertion',
      mutate: (entries: ExampleEntry[]) => entries.map((entry) => entry.verdict === 'does-not-assert' ? { id: entry.id, verdict: entry.verdict } : entry),
      reason: 'does-not-assert payload requires a non-empty missingAssertion',
    },
    {
      rule: 'an omitted entry for a supplied claim',
      mutate: (entries: ExampleEntry[]) => entries.slice(1),
      reason: 'batch verdict is missing issued claim id c1',
    },
  ])('rejects the published example once it carries $rule', async ({ mutate, reason }) => {
    const { entries, issued } = await publishedExample();

    const parsed = parseJudgeBatchPayload(batch(mutate(entries)), issued);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.reason).toContain(reason);
  });
});
