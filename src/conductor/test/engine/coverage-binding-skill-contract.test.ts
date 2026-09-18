// Covers: task:9
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseJudgeBatchPayload } from '../../src/engine/coverage-binding-envelope.js';

const skillPath = fileURLToPath(new URL('../../../../skills/coverage-binding/SKILL.md', import.meta.url));

type ExampleEntry = Record<string, unknown> & { digest: string };

/** The published example, with its `...` digest placeholders replaced by issued digests. */
async function publishedExample(): Promise<{ entries: ExampleEntry[]; digests: string[] }> {
  const skill = await readFile(skillPath, 'utf8');
  const contract = skill.slice(skill.indexOf('## Result contract'));
  const fence = /```json\n([\s\S]*?)\n```/.exec(contract);
  if (!fence) throw new Error('coverage-binding SKILL.md publishes no JSON example under "## Result contract"');
  const example = JSON.parse(fence[1]!) as { verdicts: Array<Record<string, unknown>> };
  const entries = example.verdicts.map((entry, index) => ({ ...entry, digest: `issued-${index}` }));
  return { entries, digests: entries.map((entry) => entry.digest) };
}

const batch = (entries: readonly Record<string, unknown>[]) => JSON.stringify({ verdicts: entries });

describe('coverage-binding skill contract', () => {
  it('publishes an example payload the engine batch parser accepts', async () => {
    const { entries, digests } = await publishedExample();

    const parsed = parseJudgeBatchPayload(batch(entries), digests);

    expect(parsed).toEqual({
      ok: true,
      verdicts: new Map(entries.map(({ digest, ...verdict }) => [digest, verdict])),
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
      mutate: (entries: ExampleEntry[]) => entries.map((entry) => entry.verdict === 'does-not-assert' ? { digest: entry.digest, verdict: entry.verdict } : entry),
      reason: 'does-not-assert payload requires a non-empty missingAssertion',
    },
    {
      rule: 'an omitted entry for a supplied claim',
      mutate: (entries: ExampleEntry[]) => entries.slice(1),
      reason: 'batch verdict is missing issued digest issued-0',
    },
  ])('rejects the published example once it carries $rule', async ({ mutate, reason }) => {
    const { entries, digests } = await publishedExample();

    const parsed = parseJudgeBatchPayload(batch(mutate(entries)), digests);

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? '' : parsed.reason).toContain(reason);
  });
});
