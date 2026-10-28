// Covers: task:4, task:12, task:rem-prd-audit-10-2
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  parseBuildReviewJudgedResult,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
} from '../../src/engine/build-review-domain.js';
import {
  BUILD_REVIEW_SEVERITY_DEFINITIONS,
  renderRubricContractShape,
} from '../../src/engine/build-review-contract.js';
import { BUILD_REVIEW_RUBRIC_REGISTRY } from '../../src/engine/build-review-registry.js';
import { DefaultStepRunner } from '../../src/engine/step-runners.js';
import type { InvokeOptions } from '../../src/execution/llm-provider.js';

const skill = fileURLToPath(new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url));
const securitySkill = fileURLToPath(new URL('../../../../skills/build-review-security/SKILL.md', import.meta.url));
const implementationQualitySkill = fileURLToPath(new URL('../../../../skills/build-review-implementation-quality/SKILL.md', import.meta.url));
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const retired = ['build-review-scope', 'build-review-root-cause', 'build-review-completeness'];
const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function judgementSection(skillText: string): string {
  return skillText.split('## Judgement\n')[1]?.split('\n## ')[0] ?? '';
}

function expectNoOutputShapeProse(skillText: string): void {
  expect(skillText).not.toMatch(/^## Result contract/m);
  expect(skillText).not.toMatch(/```json\b/i);
  expect(skillText).not.toMatch(/```[\s\S]*?"findings"/i);
  expect(skillText).not.toMatch(/^\*\*Closed vocabulary:\*\*/m);
  expect(skillText).not.toMatch(/^\*\*Reference grammar:\*\*/m);
  expect(skillText).not.toMatch(/Return exactly one provider payload/i);
  expect(skillText).not.toMatch(/^\s*\{/m);
  expect(skillText).not.toMatch(/^\s*-\s+(?:a |an )?(?:`[^`]+`|[A-Za-z][\w-]*)\s+field\b/im);
}

function judgedSecurityFixture(path: string, concernKind?: string, evidenceLocation = `${path}:8`) {
  const locus = { path, contentHash: hash(`${path}:${concernKind ?? 'clean'}`), display: 'introduced security-relevant hunk' };
  const findings = concernKind === undefined ? [] : [{
    concernKind,
    confidence: 90,
    summary: `The changed hunk introduces ${concernKind}.`,
    evidenceLocations: [evidenceLocation],
    anchor: { rubric: 'security', locus },
  }];
  for (const finding of findings) {
    expect(parseBuildReviewFindingConcernKind(finding.concernKind, 'security')).toBe(finding.concernKind);
    expect(parseBuildReviewFindingAnchor(finding.anchor, {
      changedTests: [], changedContentRegions: [locus], changedPaths: [path], planTasks: [],
    })).toEqual(finding.anchor);
    expect(Number.isInteger(finding.confidence)).toBe(true);
  }
  return { kind: 'judged', rubric: 'security', findings, verdict: findings.length === 0 ? 'PASS' : 'FAIL' };
}

describe('build-review rubric skill catalog', () => {
  it.each(Object.entries(BUILD_REVIEW_RUBRIC_REGISTRY).map(([rubric, descriptor]) => [
    rubric,
    descriptor.skillName,
  ] as const))(
    'keeps %s (%s) free of engine-owned severity definitions',
    async (_rubric, skillName) => {
      const content = await readFile(join(repositoryRoot, 'skills', skillName, 'SKILL.md'), 'utf8');

      for (const meaning of Object.values(BUILD_REVIEW_SEVERITY_DEFINITIONS)) {
        expect(content).not.toContain(meaning);
      }
      expect(content).not.toMatch(/`(?:critical|major|minor|nit)`/);
    },
  );

  it('pins implementation-quality defect and non-finding payload fixtures at changed hunks', () => {
    const kinds = ['duplication', 'excess-complexity', 'primitive-obsession', 'representable-invalid-state', 'non-exhaustive-domain-match'] as const;
    const failFixtures = kinds.map((concernKind, index) => {
      const locus = { path: `src/fixture-${index}.ts`, contentHash: hash(`implementation-${concernKind}`), display: 'introducing changed hunk' };
      const findings = [{ concernKind, summary: `Introduces ${concernKind}.`, evidenceLocations: concernKind === 'duplication' ? ['src/existing-block.ts:8'] : [`${locus.path}:8`], anchor: { rubric: 'implementationQuality', locus } }];
      return parseBuildReviewJudgedResult({ kind: 'judged', rubric: 'implementationQuality', lapId: 'lap-fixtures', snapshotDigest: 'sha256:fixtures', contractVersion: 'v3', findings }, { changedTests: [], changedContentRegions: [locus], changedPaths: [locus.path], planTasks: [] });
    });
    expect(failFixtures).toEqual(kinds.map((concernKind) => expect.objectContaining({ verdict: 'FAIL', findings: [expect.objectContaining({ concernKind })] })));
    for (const name of ['rename-reformat', 'partial-acceptance-criteria', 'adr-violation', 'style-only', 'unchanged-files-duplication']) {
      expect(parseBuildReviewJudgedResult({ kind: 'judged', rubric: 'implementationQuality', lapId: `lap-${name}`, snapshotDigest: 'sha256:fixtures', contractVersion: 'v3', findings: [] })).toMatchObject({ verdict: 'PASS', findings: [] });
    }
  });
  it('ships the implementation-quality skill with its complete vocabulary and non-findings', async () => {
    const content = await readFile(implementationQualitySkill, 'utf8');
    expect(content).toMatch(/^name: build-review-implementation-quality$/m);
    expect(content).toMatch(/^enforcement: gating$/m);
    expect(content).toMatch(/^phase: build$/m);
    const judgement = judgementSection(content);
    for (const kind of BUILD_REVIEW_FINDING_VOCABULARIES.implementationQuality.concernKinds) {
      expect(judgement).toContain(`\`${kind}\``);
    }
    const excessComplexity = judgement.match(/^- `excess-complexity`[\s\S]*?(?=\n- `|\nDo not|(?![\s\S]))/m)?.[0];
    expect(excessComplexity).toMatch(/four or more levels of nesting that can be flattened without changing correctness/i);
    expect(excessComplexity).not.toMatch(/correctness cost/i);
    expect(content).toMatch(/hunk that introduces/i);
    expect(content).toMatch(/style preferences/i);
  });
  it('contains only the test-quality judgement skill', async () => {
    await expect(readFile(skill, 'utf8')).resolves.toContain('name: build-review-test-quality');
    const [testInsensitive] = BUILD_REVIEW_FINDING_VOCABULARIES.testQuality.concernKinds;
    expect(testInsensitive).toBe('test-insensitive');
    expect(parseBuildReviewFindingConcernKind(testInsensitive, 'testQuality')).toBe(testInsensitive);
    expect(parseBuildReviewFindingConcernKind('not-test-insensitive', 'testQuality')).toBeUndefined();
    await Promise.all(retired.map(async (name) => {
      await expect(access(fileURLToPath(new URL(`../../../../skills/${name}/SKILL.md`, import.meta.url)), constants.F_OK)).rejects.toThrow();
    }));
  });

  it('keeps vocabulary definitions in Judgement while omitting provider-output shape prose', async () => {
    const testQualityContent = await readFile(skill, 'utf8');
    const content = await readFile(securitySkill, 'utf8');

    expect(content).toMatch(/^name: build-review-security$/m);
    expect(content).toMatch(/^disable-model-invocation: true$/m);
    expect(content).toMatch(/^enforcement: gating$/m);
    expect(content).toMatch(/^phase: build$/m);
    expectNoOutputShapeProse(testQualityContent);
    expectNoOutputShapeProse(content);
    for (const [rubric, skillText] of [['testQuality', testQualityContent], ['security', content]] as const) {
      const judgement = judgementSection(skillText);
      expect(judgement).not.toBe('');
      for (const concernKind of BUILD_REVIEW_FINDING_VOCABULARIES[rubric].concernKinds) {
        expect(judgement).toContain(`\`${concernKind}\``);
      }
    }
  });

  it('takes the assembled security prompt shape only from the descriptor', async () => {
    const invoke = vi.fn(async (_options: InvokeOptions) => ({
      success: true,
      output: '',
      exitCode: 0,
      finalStructuredResult: { findings: [] },
    }));
    const runner = new DefaultStepRunner({ invoke }, 'skill-contract', '/fixture');
    const branch = {
      rubric: 'security',
      skillName: 'build-review-security',
      policy: {
        enabled: true, llm_provider: 'claude', model: 'opus', effort: 'high',
        model_fallback_ladder: ['opus'], max_retries: 1, escalate: false,
        max_projection_bytes: 1_000_000, min_confidence: 0,
      },
    } as const;
    const projection = {
      rubric: 'security', contractVersion: 'v3', projectionVersion: 'v3',
      lapId: 'lap-a237011e9f263dd47ca1a2c7cfe929865c2e99b8', snapshotDigest: 'sha256:projection',
      digest: 'sha256:projection', mergeBase: 'base', headSha: 'head', changedFiles: [],
    };

    await (runner as unknown as {
      dispatchBuildReviewRubric: (value: typeof branch, reviewProjection: typeof projection) => Promise<unknown>;
    }).dispatchBuildReviewRubric(branch, projection);

    const prompt = invoke.mock.calls[0]?.[0]?.prompt ?? '';
    const shapeBlock = prompt.match(/Your final message MUST end with one JSON object matching this schema:\n([^\n]+)/)?.[1];
    expect(shapeBlock).toBe(renderRubricContractShape(BUILD_REVIEW_RUBRIC_REGISTRY.security.contract));
  });

  it('keeps representative security judgements anchored to their introducing hunks', () => {
    const fixtures = [
      judgedSecurityFixture('src/config.ts', 'committed-secret'),
      judgedSecurityFixture('src/commands.ts', 'injection'),
      judgedSecurityFixture('src/handlers/admin.ts', 'broken-access-control'),
      judgedSecurityFixture('src/http/fetch.ts', 'ssrf'),
    ];

    expect(fixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({ verdict: 'FAIL', findings: [expect.objectContaining({ concernKind: 'committed-secret' })] }),
      expect.objectContaining({ verdict: 'FAIL', findings: [expect.objectContaining({ concernKind: 'injection' })] }),
      expect.objectContaining({ verdict: 'FAIL', findings: [expect.objectContaining({ concernKind: 'broken-access-control' })] }),
      expect.objectContaining({ verdict: 'FAIL', findings: [expect.objectContaining({ concernKind: 'ssrf' })] }),
    ]));
  });

  it('keeps non-security fixture diffs free of blocking findings', () => {
    const fixtures = [
      judgedSecurityFixture('src/handler.ts'),
      judgedSecurityFixture('test/fixtures/credential.ts'),
      judgedSecurityFixture('package.json'),
      judgedSecurityFixture('docs/design.md'),
    ];

    expect(fixtures).toEqual(fixtures.map((_fixture) => expect.objectContaining({ verdict: 'PASS', findings: [] })));
  });

  it('anchors an unchanged-sink exposure to its changed hunk', () => {
    const [fixture] = [judgedSecurityFixture('src/request.ts', 'injection', 'src/legacy-request.ts:42')];
    const [finding] = fixture.findings;

    expect(fixture).toEqual(expect.objectContaining({ verdict: 'FAIL', findings: [expect.any(Object)] }));
    expect(finding).toEqual(expect.objectContaining({
      concernKind: 'injection',
      anchor: expect.objectContaining({ locus: expect.objectContaining({ path: 'src/request.ts' }) }),
      evidenceLocations: ['src/legacy-request.ts:42'],
    }));
  });
});
