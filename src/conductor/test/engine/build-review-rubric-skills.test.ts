// Covers: task:12
import { createHash } from 'node:crypto';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  BUILD_REVIEW_FINDING_VOCABULARIES,
  parseBuildReviewFindingAnchor,
  parseBuildReviewFindingConcernKind,
} from '../../src/engine/build-review-domain.js';

const skill = fileURLToPath(new URL('../../../../skills/build-review-test-quality/SKILL.md', import.meta.url));
const securitySkill = fileURLToPath(new URL('../../../../skills/build-review-security/SKILL.md', import.meta.url));
const retired = ['build-review-scope', 'build-review-root-cause', 'build-review-completeness'];
const hash = (text: string) => `sha256:${createHash('sha256').update(text).digest('hex')}`;

function judgedSecurityFixture(path: string, concernKind?: string) {
  const locus = { path, contentHash: hash(`${path}:${concernKind ?? 'clean'}`), display: 'introduced security-relevant hunk' };
  const findings = concernKind === undefined ? [] : [{
    concernKind,
    confidence: 90,
    summary: `The changed hunk introduces ${concernKind}.`,
    evidenceLocations: [`${path}:8`],
    anchor: { rubric: 'security', locus },
  }];
  for (const finding of findings) {
    expect(parseBuildReviewFindingConcernKind(finding.concernKind, 'security')).toBe(finding.concernKind);
    expect(parseBuildReviewFindingAnchor(finding.anchor, {
      changedTests: [], changedPaths: [path], planTasks: [],
    })).toEqual(finding.anchor);
    expect(Number.isInteger(finding.confidence)).toBe(true);
  }
  return { kind: 'judged', rubric: 'security', findings, verdict: findings.length === 0 ? 'PASS' : 'FAIL' };
}

describe('build-review rubric skill catalog', () => {
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

  it('contains the security judgement skill with the closed vocabulary and content-region grammar', async () => {
    const content = await readFile(securitySkill, 'utf8');

    expect(content).toMatch(/^name: build-review-security$/m);
    expect(content).toMatch(/^disable-model-invocation: true$/m);
    expect(content).toMatch(/^enforcement: gating$/m);
    expect(content).toMatch(/^phase: build$/m);
    expect(content).toMatch(/\*\*Closed vocabulary:\*\* `committed-secret`, `injection`, `broken-access-control`, `path-traversal`, `unsafe-deserialization`, `cryptographic-failure`, `security-misconfiguration`, `authentication-failure`, `integrity-failure`, `ssrf`\./);
    expect(content).toMatch(/\*\*Reference grammar:\*\* `anchor\.locus` is a `content-region` reference\./);
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
      judgedSecurityFixture('src/request.ts'),
    ];

    expect(fixtures).toEqual(fixtures.map((fixture) => expect.objectContaining({ verdict: 'PASS', findings: [] })));
  });
});
